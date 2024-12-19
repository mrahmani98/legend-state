import { observable, symbolDelete, isString, isArray, isObject, computeSelector, isFunction, isNullOrUndefined, isPromise, isNumber, when } from '@legendapp/state';
import { syncedCrud } from '@legendapp/state/sync-plugins/crud';
import { getAuth } from 'firebase/auth';
import { ref, getDatabase, query, orderByChild, startAt, update, onValue, onChildAdded, onChildChanged, onChildRemoved, serverTimestamp, remove, push } from 'firebase/database';

// src/sync-plugins/firebase.ts
var validateMap;
function transformObjectFields(dataIn, map) {
  if (process.env.NODE_ENV === "development") {
    validateMap(map);
  }
  let ret = dataIn;
  if (dataIn) {
    if (dataIn === symbolDelete)
      return dataIn;
    if (isString(dataIn)) {
      return map[dataIn];
    }
    ret = {};
    const dict = Object.keys(map).length === 1 && map["_dict"];
    for (const key in dataIn) {
      let v = dataIn[key];
      if (dict) {
        ret[key] = transformObjectFields(v, dict);
      } else {
        const mapped = map[key];
        if (mapped === void 0) {
          if (key !== "@") {
            ret[key] = v;
            if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
              console.error("A fatal field transformation error has occurred", key, dataIn, map);
            }
          }
        } else if (mapped !== null) {
          if (v !== void 0 && v !== null) {
            if (map[key + "_val"]) {
              const mapChild = map[key + "_val"];
              if (isArray(v)) {
                v = v.map((vChild) => mapChild[vChild]);
              } else {
                v = mapChild[v];
              }
            } else if (map[key + "_arr"] && isArray(v)) {
              const mapChild = map[key + "_arr"];
              v = v.map((vChild) => transformObjectFields(vChild, mapChild));
            } else if (isObject(v)) {
              if (map[key + "_obj"]) {
                v = transformObjectFields(v, map[key + "_obj"]);
              } else if (map[key + "_dict"]) {
                const mapChild = map[key + "_dict"];
                const out = {};
                for (const keyChild in v) {
                  out[keyChild] = transformObjectFields(v[keyChild], mapChild);
                }
                v = out;
              }
            }
          }
          ret[mapped] = v;
        }
      }
    }
  }
  return ret;
}
var invertedMaps = /* @__PURE__ */ new WeakMap();
function invertFieldMap(obj) {
  const existing = invertedMaps.get(obj);
  if (existing)
    return existing;
  const target = {};
  for (const key in obj) {
    const val = obj[key];
    if (key === "_dict") {
      target[key] = invertFieldMap(val);
    } else if (key.endsWith("_obj") || key.endsWith("_dict") || key.endsWith("_arr") || key.endsWith("_val")) {
      const keyMapped = obj[key.replace(/_obj|_dict|_arr|_val$/, "")];
      const suffix = key.match(/_obj|_dict|_arr|_val$/)[0];
      target[keyMapped + suffix] = invertFieldMap(val);
    } else if (typeof val === "string") {
      target[val] = key;
    }
  }
  invertedMaps.set(obj, target);
  return target;
}
if (process.env.NODE_ENV === "development") {
  validateMap = function(record) {
    const values = Object.values(record).filter((value) => {
      if (isObject(value)) {
        validateMap(value);
      } else {
        return isString(value);
      }
    });
    const uniques = Array.from(new Set(values));
    if (values.length !== uniques.length) {
      console.error("Field transform map has duplicate values", record, values.length, uniques.length);
    }
    return record;
  };
}

// src/sync-plugins/firebase.ts
var isEnabled$ = observable(true);
var firebaseConfig = {};
function configureSyncedFirebase(config) {
  const { enabled, ...rest } = config;
  Object.assign(firebaseConfig, rest);
  if (enabled !== void 0) {
    isEnabled$.set(enabled);
  }
}
function joinPaths(str1, str2) {
  return str2 ? [str1, str2].join("/").replace(/\/\//g, "/") : str1;
}
var fns = {
  isInitialized: () => {
    try {
      return !!getAuth().app;
    } catch (e) {
      return false;
    }
  },
  getCurrentUser: () => {
    var _a;
    return (_a = getAuth().currentUser) == null ? void 0 : _a.uid;
  },
  ref: (path) => ref(getDatabase(), path),
  orderByChild: (ref, child, start) => query(ref, orderByChild(child), startAt(start)),
  update: (ref, object) => update(ref, object),
  once: (ref, callback, callbackError) => {
    let unsubscribe;
    const cb = (snap) => {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = void 0;
      }
      callback(snap);
    };
    unsubscribe = onValue(ref, cb, callbackError);
    return unsubscribe;
  },
  onChildAdded,
  onChildChanged,
  onChildRemoved,
  onValue,
  serverTimestamp,
  remove: remove,
  onAuthStateChanged: (cb) => getAuth().onAuthStateChanged(cb),
  generateId: () => push(ref(getDatabase())).key
};
function syncedFirebase(props) {
  props = { ...firebaseConfig, ...props };
  const saving$ = observable({});
  const pendingOutgoing$ = observable({});
  const pendingIncoming$ = observable({});
  let didList = false;
  const {
    refPath,
    query,
    fieldId,
    realtime,
    requireAuth,
    readonly,
    transform: transformProp,
    fieldTransforms,
    waitFor,
    waitForSet,
    ...rest
  } = props;
  const { fieldCreatedAt, changesSince } = props;
  const asType = props.as || "value";
  const fieldUpdatedAt = props.fieldUpdatedAt || "@";
  const computeRef = (lastSync) => {
    const pathFirebase = refPath(fns.getCurrentUser());
    let ref = fns.ref(pathFirebase);
    if (query) {
      ref = query(ref);
    }
    if (changesSince === "last-sync" && lastSync && fieldUpdatedAt && isNumber(lastSync)) {
      ref = fns.orderByChild(ref, fieldUpdatedAt, lastSync + 1);
    }
    return ref;
  };
  const list = async (getParams) => {
    const { lastSync, onError } = getParams;
    const ref = computeRef(lastSync);
    return new Promise((resolve) => {
      fns.once(
        ref,
        async (snap) => {
          const val = snap.val();
          let values = [];
          if (!isNullOrUndefined(val)) {
            values = asType === "value" ? [val] : Object.entries(val).map(([key, value]) => {
              if (fieldId && !value[fieldId]) {
                value[fieldId] = key;
              }
              return value;
            });
          }
          didList = true;
          resolve(values);
        },
        (error) => onError(error, { source: "list", type: "get", retry: getParams })
      );
    });
  };
  const subscribe = realtime ? ({ lastSync, update: update2, onError }) => {
    const ref = computeRef(lastSync);
    let unsubscribes;
    if (asType === "value") {
      const onValue2 = (snap) => {
        if (!didList)
          return;
        const val = snap.val();
        if (saving$[""].get()) {
          pendingIncoming$[""].set(val);
        } else {
          update2({
            value: [val],
            mode: "set"
          });
        }
      };
      unsubscribes = [fns.onValue(ref, onValue2, onError)];
    } else {
      const onChildChange = (snap) => {
        if (!didList)
          return;
        const key = snap.key;
        const val = snap.val();
        if (fieldId && !val[fieldId]) {
          val[fieldId] = key;
        }
        if (saving$[key].get()) {
          pendingIncoming$[key].set(val);
        } else {
          update2({
            value: [val],
            mode: "assign"
          });
        }
      };
      const onChildDelete = (snap) => {
        if (!didList)
          return;
        const key = snap.key;
        const val = snap.val();
        if (fieldId && !val[fieldId]) {
          val[fieldId] = key;
        }
        val[symbolDelete] = true;
        update2({
          value: [val],
          mode: "assign"
        });
      };
      unsubscribes = [
        fns.onChildAdded(ref, onChildChange, onError),
        fns.onChildChanged(ref, onChildChange, onError),
        fns.onChildRemoved(ref, onChildDelete, onError)
      ];
    }
    return () => {
      unsubscribes.forEach((fn) => fn());
    };
  } : void 0;
  const addUpdatedAt = (input) => {
    if (fieldUpdatedAt) {
      input[fieldUpdatedAt] = serverTimestamp();
    }
  };
  const addCreatedAt = (input) => {
    if (fieldCreatedAt && !input[fieldCreatedAt]) {
      input[fieldCreatedAt] = serverTimestamp();
    }
    return addUpdatedAt(input);
  };
  const upsert = async (input) => {
    const id = fieldId ? input[fieldId] : "";
    if (saving$[id].get()) {
      pendingOutgoing$[id].set(input);
    } else {
      saving$[id].set(true);
      const path = joinPaths(refPath(fns.getCurrentUser()), fieldId ? id : "");
      await fns.update(fns.ref(path), input);
      saving$[id].set(false);
      flushAfterSave();
    }
    return when(
      () => !pendingOutgoing$[id].get(),
      () => {
        const value = pendingIncoming$[id].get();
        if (value) {
          pendingIncoming$[id].delete();
          return value;
        }
      }
    );
  };
  const flushAfterSave = () => {
    const outgoing = pendingOutgoing$.get();
    Object.values(outgoing).forEach((value) => {
      upsert(value);
    });
    pendingOutgoing$.set({});
  };
  const create = readonly ? void 0 : (input) => {
    addCreatedAt(input);
    return upsert(input);
  };
  const update = readonly ? void 0 : (input) => {
    addUpdatedAt(input);
    return upsert(input);
  };
  const deleteFn = readonly ? void 0 : (input) => {
    const path = joinPaths(
      refPath(fns.getCurrentUser()),
      fieldId && asType !== "value" ? input[fieldId] : ""
    );
    return fns.remove(fns.ref(path));
  };
  let isAuthedIfRequired$;
  if (requireAuth) {
    if (fns.isInitialized()) {
      isAuthedIfRequired$ = observable(false);
      fns.onAuthStateChanged((user) => {
        isAuthedIfRequired$.set(!!user);
      });
    }
  }
  let transform = transformProp;
  if (fieldTransforms) {
    const inverted = invertFieldMap(fieldTransforms);
    transform = {
      load(value, method) {
        const fieldTransformed = transformObjectFields(value, inverted);
        return (transformProp == null ? void 0 : transformProp.load) ? transformProp.load(fieldTransformed, method) : fieldTransformed;
      },
      save(value) {
        const transformed = (transformProp == null ? void 0 : transformProp.save) ? transformProp.save(value) : value;
        if (isPromise(transformed)) {
          return transformed.then((transformedValue) => {
            return transformObjectFields(transformedValue, fieldTransforms);
          });
        } else {
          return transformObjectFields(transformed, fieldTransforms);
        }
      }
    };
  }
  return syncedCrud({
    ...rest,
    // Workaround for type errors
    list,
    subscribe,
    create,
    update,
    delete: deleteFn,
    waitFor: () => isEnabled$.get() && (isAuthedIfRequired$ ? isAuthedIfRequired$.get() : true) && (waitFor ? computeSelector(waitFor) : true),
    waitForSet: (params) => isEnabled$.get() && (isAuthedIfRequired$ ? isAuthedIfRequired$.get() : true) && (waitForSet ? isFunction(waitForSet) ? waitForSet(params) : waitForSet : true),
    generateId: fns.generateId,
    transform,
    as: asType
  });
}

export { configureSyncedFirebase, invertFieldMap, syncedFirebase, transformObjectFields };
