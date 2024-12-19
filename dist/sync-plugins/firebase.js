'use strict';

var state = require('@legendapp/state');
var crud = require('@legendapp/state/sync-plugins/crud');
var auth = require('firebase/auth');
var database = require('firebase/database');

// src/sync-plugins/firebase.ts
var validateMap;
function transformObjectFields(dataIn, map) {
  if (process.env.NODE_ENV === "development") {
    validateMap(map);
  }
  let ret = dataIn;
  if (dataIn) {
    if (dataIn === state.symbolDelete)
      return dataIn;
    if (state.isString(dataIn)) {
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
              if (state.isArray(v)) {
                v = v.map((vChild) => mapChild[vChild]);
              } else {
                v = mapChild[v];
              }
            } else if (map[key + "_arr"] && state.isArray(v)) {
              const mapChild = map[key + "_arr"];
              v = v.map((vChild) => transformObjectFields(vChild, mapChild));
            } else if (state.isObject(v)) {
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
      if (state.isObject(value)) {
        validateMap(value);
      } else {
        return state.isString(value);
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
var isEnabled$ = state.observable(true);
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
      return !!auth.getAuth().app;
    } catch (e) {
      return false;
    }
  },
  getCurrentUser: () => {
    var _a;
    return (_a = auth.getAuth().currentUser) == null ? void 0 : _a.uid;
  },
  ref: (path) => database.ref(database.getDatabase(), path),
  orderByChild: (ref, child, start) => database.query(ref, database.orderByChild(child), database.startAt(start)),
  update: (ref, object) => database.update(ref, object),
  once: (ref, callback, callbackError) => {
    let unsubscribe;
    const cb = (snap) => {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = void 0;
      }
      callback(snap);
    };
    unsubscribe = database.onValue(ref, cb, callbackError);
    return unsubscribe;
  },
  onChildAdded: database.onChildAdded,
  onChildChanged: database.onChildChanged,
  onChildRemoved: database.onChildRemoved,
  onValue: database.onValue,
  serverTimestamp: database.serverTimestamp,
  remove: database.remove,
  onAuthStateChanged: (cb) => auth.getAuth().onAuthStateChanged(cb),
  generateId: () => database.push(database.ref(database.getDatabase())).key
};
function syncedFirebase(props) {
  props = { ...firebaseConfig, ...props };
  const saving$ = state.observable({});
  const pendingOutgoing$ = state.observable({});
  const pendingIncoming$ = state.observable({});
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
    if (changesSince === "last-sync" && lastSync && fieldUpdatedAt && state.isNumber(lastSync)) {
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
          if (!state.isNullOrUndefined(val)) {
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
        val[state.symbolDelete] = true;
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
      input[fieldUpdatedAt] = database.serverTimestamp();
    }
  };
  const addCreatedAt = (input) => {
    if (fieldCreatedAt && !input[fieldCreatedAt]) {
      input[fieldCreatedAt] = database.serverTimestamp();
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
    return state.when(
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
      isAuthedIfRequired$ = state.observable(false);
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
        if (state.isPromise(transformed)) {
          return transformed.then((transformedValue) => {
            return transformObjectFields(transformedValue, fieldTransforms);
          });
        } else {
          return transformObjectFields(transformed, fieldTransforms);
        }
      }
    };
  }
  return crud.syncedCrud({
    ...rest,
    // Workaround for type errors
    list,
    subscribe,
    create,
    update,
    delete: deleteFn,
    waitFor: () => isEnabled$.get() && (isAuthedIfRequired$ ? isAuthedIfRequired$.get() : true) && (waitFor ? state.computeSelector(waitFor) : true),
    waitForSet: (params) => isEnabled$.get() && (isAuthedIfRequired$ ? isAuthedIfRequired$.get() : true) && (waitForSet ? state.isFunction(waitForSet) ? waitForSet(params) : waitForSet : true),
    generateId: fns.generateId,
    transform,
    as: asType
  });
}

exports.configureSyncedFirebase = configureSyncedFirebase;
exports.invertFieldMap = invertFieldMap;
exports.syncedFirebase = syncedFirebase;
exports.transformObjectFields = transformObjectFields;
