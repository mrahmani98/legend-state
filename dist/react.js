'use strict';

var state = require('@legendapp/state');
var React = require('react');
var index_js = require('use-sync-external-store/shim/index.js');
var enableReactive = require('@legendapp/state/react-reactive/enableReactive');

function _interopDefault (e) { return e && e.__esModule ? e : { default: e }; }

var React__default = /*#__PURE__*/_interopDefault(React);

// src/react/Computed.tsx

// src/react/react-globals.ts
var reactGlobals = {
  inObserver: false
};
var pauseContext = void 0;
var getPauseContext = () => {
  return pauseContext || (pauseContext = React.createContext(null));
};
function usePauseProvider() {
  const [value] = React.useState(() => state.observable(false));
  return {
    PauseProvider: ({ children }) => React.createElement(getPauseContext().Provider, { value }, children),
    isPaused$: value
  };
}

// src/react/useSelector.ts
function createSelectorFunctions(options, isPaused$) {
  let version = 0;
  let notify;
  let dispose;
  let resubscribe;
  let _selector;
  let prev;
  let pendingUpdate = void 0;
  const run = () => {
    dispose == null ? void 0 : dispose();
    const {
      value,
      dispose: _dispose,
      resubscribe: _resubscribe
    } = state.trackSelector(
      _selector,
      _update,
      options,
      void 0,
      void 0,
      /*createResubscribe*/
      true
    );
    dispose = _dispose;
    resubscribe = _resubscribe;
    return value;
  };
  const _update = ({ value }) => {
    if (isPaused$ == null ? void 0 : isPaused$.peek()) {
      const next = pendingUpdate;
      pendingUpdate = value;
      if (next === void 0) {
        state.when(
          () => !isPaused$.get(),
          () => {
            const latest = pendingUpdate;
            pendingUpdate = void 0;
            _update({ value: latest });
          }
        );
      }
    } else {
      let changed = options == null ? void 0 : options.skipCheck;
      if (!changed) {
        const newValue = run();
        if (newValue !== prev || !state.isPrimitive(newValue) && newValue === value) {
          changed = true;
        }
      }
      if (changed) {
        version++;
        notify == null ? void 0 : notify();
      }
    }
  };
  return {
    subscribe: (onStoreChange) => {
      notify = onStoreChange;
      if ((process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") && !dispose && resubscribe) {
        dispose = resubscribe();
      }
      return () => {
        dispose == null ? void 0 : dispose();
        dispose = void 0;
      };
    },
    getVersion: () => version,
    run: (selector) => {
      _selector = selector;
      return prev = run();
    }
  };
}
function doSuspense(selector) {
  const vProm = state.when(selector);
  if (React__default.default.use) {
    React__default.default.use(vProm);
  } else {
    throw vProm;
  }
}
function useSelector(selector, options) {
  var _a;
  let value;
  if (reactGlobals.inObserver && state.isObservable(selector) && !(options == null ? void 0 : options.suspense)) {
    value = state.computeSelector(selector, options);
    if ((options == null ? void 0 : options.suspense) && value === void 0) {
      doSuspense(selector);
    }
    return value;
  }
  try {
    const isPaused$ = React.useContext(getPauseContext());
    const selectorFn = React.useMemo(() => createSelectorFunctions(options, isPaused$), []);
    const { subscribe, getVersion, run } = selectorFn;
    value = run(selector);
    index_js.useSyncExternalStore(subscribe, getVersion, getVersion);
  } catch (err) {
    if ((process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") && ((_a = err == null ? void 0 : err.message) == null ? void 0 : _a.includes("Rendered more"))) {
      console.warn(
        `[legend-state]: You may want to wrap this component in \`observer\` to fix the error of ${err.message}`
      );
    }
    throw err;
  }
  if ((options == null ? void 0 : options.suspense) && value === void 0) {
    doSuspense(selector);
  }
  return value;
}

// src/react/Computed.tsx
function Computed({ children }) {
  return useSelector(() => state.computeSelector(state.computeSelector(children)), { skipCheck: true });
}
var hasSymbol = typeof Symbol === "function" && Symbol.for;
var didWarnProps = false;
function createReactiveComponent(component, observe3, reactive2, keysReactive, bindKeys) {
  const ReactForwardRefSymbol = hasSymbol ? Symbol.for("react.forward_ref") : (
    // eslint-disable-next-line react/display-name, @typescript-eslint/no-unused-vars
    typeof React.forwardRef === "function" && React.forwardRef((props) => null)["$$typeof"]
  );
  const ReactMemoSymbol = hasSymbol ? Symbol.for("react.memo") : (
    // eslint-disable-next-line react/display-name, @typescript-eslint/no-unused-vars
    typeof React.forwardRef === "function" && React.memo((props) => null)["$$typeof"]
  );
  if (component["__legend_proxied"])
    return component;
  let useForwardRef = false;
  let useMemo4 = false;
  let render = component;
  if (ReactMemoSymbol && render["$$typeof"] === ReactMemoSymbol && render["type"]) {
    useMemo4 = true;
    render = render["type"];
  }
  if (ReactForwardRefSymbol && render["$$typeof"] === ReactForwardRefSymbol) {
    useForwardRef = true;
    render = render["render"];
    if (process.env.NODE_ENV === "development" && typeof render !== "function") {
      throw new Error(`[legend-state] \`render\` property of ForwardRef was not a function`);
    }
  }
  const keysReactiveSet = keysReactive ? new Set(keysReactive) : void 0;
  const proxyHandler = {
    apply(target, thisArg, argArray) {
      if (reactive2) {
        const props = argArray[0];
        const propsOut = {};
        const keys = Object.keys(props);
        for (let i = 0; i < keys.length; i++) {
          const key = keys[i];
          const p = props[key];
          const isReactiveKey = keysReactiveSet && keysReactiveSet.has(key);
          if (key === "children" && (state.isFunction(p) || state.isObservable(p))) {
            props[key] = useSelector(p, { skipCheck: true });
          } else if (isReactiveKey || key.startsWith("$") || key.endsWith("$")) {
            if (process.env.NODE_ENV === "development" && !didWarnProps && key.endsWith("$")) {
              didWarnProps = true;
              console.warn(
                `[legend-state] Reactive props were changed to start with $ instead of end with $ in version 2.0. So please change ${key} to $${key.replace(
                  "$",
                  ""
                )}. See https://legendapp.com/open-source/state/migrating for more details.`
              );
            }
            const k = isReactiveKey ? key : key.endsWith("$") ? key.slice(0, -1) : key.slice(1);
            const bind = bindKeys == null ? void 0 : bindKeys[k];
            const shouldBind = bind && state.isObservable(p);
            propsOut[k] = shouldBind && (bind == null ? void 0 : bind.selector) ? bind.selector(propsOut, p) : useSelector(p);
            if (shouldBind) {
              if (bind.defaultValue !== void 0 && propsOut[k] === void 0) {
                propsOut[k] = bind.defaultValue;
              }
              if (bind.handler && bind.getValue) {
                const handlerFn = (e) => {
                  var _a;
                  p.set(bind.getValue(e));
                  (_a = props[bind.handler]) == null ? void 0 : _a.call(props, e);
                };
                propsOut[bind.handler] = // If in development mode, don't memoize the handler. fix fast refresh bug
                process.env.NODE_ENV === "development" ? handlerFn : React.useCallback(handlerFn, [props[bind.handler], bindKeys]);
              }
            }
            if (!isReactiveKey) {
              delete propsOut[key];
            }
          } else if (propsOut[key] === void 0) {
            propsOut[key] = p;
          }
        }
        argArray[0] = propsOut;
      }
      if (observe3) {
        return useSelector(
          () => {
            reactGlobals.inObserver = true;
            try {
              return Reflect.apply(target, thisArg, argArray);
            } finally {
              reactGlobals.inObserver = false;
            }
          },
          { skipCheck: true }
        );
      } else {
        return Reflect.apply(target, thisArg, argArray);
      }
    }
  };
  const proxy = new Proxy(render, proxyHandler);
  let ret;
  if (useForwardRef) {
    ret = React.forwardRef(proxy);
    ret["__legend_proxied"] = true;
  } else {
    ret = proxy;
  }
  return observe3 || useMemo4 ? React.memo(ret) : ret;
}
function observer(component) {
  return createReactiveComponent(component, true);
}
function reactive(component, keys, bindKeys) {
  return createReactiveComponent(component, false, true, keys, bindKeys);
}
function reactiveObserver(component, keys, bindKeys) {
  return createReactiveComponent(component, true, true, keys, bindKeys);
}
function reactiveComponents(components) {
  return new Proxy(
    {},
    {
      get(target, p) {
        if (!target[p] && components[p]) {
          target[p] = createReactiveComponent(components[p], false, true);
        }
        return target[p];
      }
    }
  );
}

// src/react/For.tsx
var { findIDKey, getNode, optimized } = state.internal;
var autoMemoCache = /* @__PURE__ */ new Map();
function For({
  each,
  optimized: isOptimized,
  item,
  itemProps,
  sortValues,
  children
}) {
  var _a;
  if (!each)
    return null;
  const value = useSelector(() => each.get(isOptimized ? optimized : true));
  if (!item && children) {
    const refChildren = React.useRef();
    refChildren.current = children;
    item = React.useMemo(() => observer(({ item$, id }) => refChildren.current(item$, id)), []);
  } else {
    if (item.$$typeof !== Symbol.for("react.memo")) {
      let memod = autoMemoCache.get(item);
      if (!memod) {
        memod = React.memo(item);
        autoMemoCache.set(item, memod);
      }
      item = memod;
    }
  }
  if (!value)
    return null;
  const out = [];
  const isArr = state.isArray(value);
  if (isArr) {
    const v0 = value[0];
    const node = getNode(each);
    const length = value.length;
    const idField = length > 0 ? node && findIDKey(v0, node) || (v0.id !== void 0 ? "id" : v0.key !== void 0 ? "key" : void 0) : void 0;
    const isIdFieldFunction = state.isFunction(idField);
    for (let i = 0; i < length; i++) {
      if (value[i]) {
        const val = value[i];
        const key = (_a = isIdFieldFunction ? idField(val) : val[idField]) != null ? _a : i;
        const item$ = each[i];
        const props = {
          key,
          id: key,
          item$,
          item: item$
        };
        out.push(React.createElement(item, itemProps ? Object.assign(props, itemProps) : props));
      }
    }
  } else {
    const asMap = state.isMap(value);
    const keys = asMap ? Array.from(value.keys()) : Object.keys(value);
    if (sortValues) {
      keys.sort((A, B) => sortValues(asMap ? value.get(A) : value[A], asMap ? value.get(B) : value[B], A, B));
    }
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (asMap ? value.get(key) : value[key]) {
        const item$ = asMap ? each.get(key) : each[key];
        const props = {
          key,
          id: key,
          item$,
          item: item$
        };
        out.push(React.createElement(item, itemProps ? Object.assign(props, itemProps) : props));
      }
    }
  }
  return out;
}
var Memo = React.memo(
  Computed,
  (prev, next) => next.scoped ? prev.children === next.children : true
);

// src/react/configureReactive.ts
var ReactiveFns = /* @__PURE__ */ new Map();
var ReactiveFnBinders = /* @__PURE__ */ new Map();
function configureReactive({
  components,
  binders
}) {
  if (components) {
    for (const key in components) {
      ReactiveFns.set(key, components[key]);
    }
  }
  if (binders) {
    for (const key in binders) {
      ReactiveFnBinders.set(key, binders[key]);
    }
  }
}

// src/react/Reactive.tsx
var Reactive = new Proxy(
  {},
  {
    get(target, p) {
      if (!target[p]) {
        const Component = ReactiveFns.get(p) || p;
        const render = React.forwardRef((props, ref) => {
          const propsOut = { ...props };
          if (ref && (state.isFunction(ref) || !state.isEmpty(ref))) {
            propsOut.ref = ref;
          }
          return React.createElement(Component, propsOut);
        });
        target[p] = reactive(render, [], ReactiveFnBinders.get(p));
      }
      return target[p];
    }
  }
);
if (process.env.NODE_ENV !== "test") {
  enableReactive.enableReactive(configureReactive);
}
function Show({ if: if_, ifReady, else: else_, $value, wrap, children }) {
  const value = useSelector(if_ != null ? if_ : ifReady);
  const show = ifReady !== void 0 ? state.isObservableValueReady(value) : value;
  const child = useSelector(
    show ? state.isFunction(children) ? () => children($value ? $value.get() : value) : children : else_ != null ? else_ : null,
    { skipCheck: true }
  );
  return wrap ? React.createElement(wrap, void 0, child) : child;
}

// src/react/Switch.tsx
function Switch({
  value,
  children
}) {
  var _a, _b;
  const child = children[useSelector(value)];
  return (_b = child ? child() : (_a = children["default"]) == null ? void 0 : _a.call(children)) != null ? _b : null;
}
function useObservable(initialValue, deps) {
  var _a;
  const ref = React.useRef({});
  ref.current.value = initialValue;
  const depsObs$ = deps ? useObservable(deps) : void 0;
  if (!((_a = ref.current) == null ? void 0 : _a.obs$)) {
    const value = depsObs$ ? state.isFunction(initialValue) && initialValue.length === 1 ? (p) => {
      depsObs$.get();
      return ref.current.value(p);
    } : () => {
      depsObs$.get();
      return state.computeSelector(ref.current.value);
    } : initialValue;
    ref.current.obs$ = state.observable(value);
  }
  if (depsObs$) {
    depsObs$.set(deps);
  }
  return ref.current.obs$;
}

// src/react/useComputed.ts
function useComputed(get, set, deps) {
  if (!deps && state.isArray(set)) {
    deps = set;
    set = void 0;
  }
  return useObservable(
    set ? state.linked({ get, set: ({ value }) => set(value) }) : get,
    deps
  );
}
var useEffectOnce = (effect, deps) => {
  if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
    const refDispose = React.useRef({ num: 0 });
    React.useEffect(() => {
      var _a;
      const { current } = refDispose;
      current.num++;
      const dispose = () => {
        if (current.dispose && current.num < 2) {
          current.dispose();
          current.dispose = void 0;
        }
        current.num--;
      };
      if (current.dispose === void 0) {
        const ret = (_a = effect()) != null ? _a : null;
        if (ret && state.isFunction(ret)) {
          current.dispose = ret;
          return () => queueMicrotask(dispose);
        }
      } else {
        return dispose;
      }
    }, deps);
  } else {
    React.useEffect(effect, deps);
  }
};
function useMount(fn) {
  return useEffectOnce(() => {
    const ret = fn();
    if (!state.isPromise(ret)) {
      return ret;
    }
  }, []);
}
var useMountOnce = useMount;

// src/react/useIsMounted.ts
function useIsMounted() {
  const obs = useObservable(false);
  const { set } = obs;
  useMountOnce(() => {
    set(true);
    return () => set(false);
  });
  return obs;
}
function useObservableReducer(reducer, initializerArg, initializer) {
  const obs = useObservable(
    () => initializerArg !== void 0 && state.isFunction(initializerArg) ? initializer(initializerArg) : initializerArg
  );
  const dispatch = (action) => {
    obs.set(reducer(obs.get(), action));
  };
  return [obs, dispatch];
}

// src/react/useUnmount.ts
function useUnmount(fn) {
  return useMount(() => fn);
}
var useUnmountOnce = useUnmount;

// src/react/useObserve.ts
function useObserve(selector, reactionOrOptions, options) {
  let reaction;
  if (state.isFunction(reactionOrOptions)) {
    reaction = reactionOrOptions;
  } else {
    options = reactionOrOptions;
  }
  const deps = options == null ? void 0 : options.deps;
  const depsObs$ = deps ? useObservable(deps) : void 0;
  if (depsObs$) {
    depsObs$.set(deps);
  }
  const ref = React.useRef({});
  ref.current.selector = deps ? () => {
    depsObs$ == null ? void 0 : depsObs$.get();
    return state.computeSelector(selector);
  } : selector;
  ref.current.reaction = reaction;
  if (!ref.current.dispose) {
    ref.current.dispose = state.observe(
      (e) => state.computeSelector(ref.current.selector, void 0, e),
      (e) => {
        var _a, _b;
        return (_b = (_a = ref.current).reaction) == null ? void 0 : _b.call(_a, e);
      },
      options
    );
  }
  useUnmountOnce(() => {
    var _a, _b;
    (_b = (_a = ref.current) == null ? void 0 : _a.dispose) == null ? void 0 : _b.call(_a);
  });
  return ref.current.dispose;
}
function useObserveEffect(selector, reactionOrOptions, options) {
  let reaction;
  if (state.isFunction(reactionOrOptions)) {
    reaction = reactionOrOptions;
  } else {
    options = reactionOrOptions;
  }
  const deps = options == null ? void 0 : options.deps;
  const depsObs$ = deps ? useObservable(deps) : void 0;
  if (depsObs$) {
    depsObs$.set(deps);
  }
  const ref = React.useRef({ selector });
  ref.current = { selector, reaction };
  useMountOnce(
    () => state.observe(
      (e) => {
        const { selector: selector2 } = ref.current;
        depsObs$ == null ? void 0 : depsObs$.get();
        return state.isFunction(selector2) ? selector2(e) : selector2;
      },
      (e) => {
        var _a, _b;
        return (_b = (_a = ref.current).reaction) == null ? void 0 : _b.call(_a, e);
      },
      options
    )
  );
}
function useWhen(predicate, effect) {
  return React.useMemo(() => state.when(predicate, effect), []);
}
function useWhenReady(predicate, effect) {
  return React.useMemo(() => state.whenReady(predicate, effect), []);
}

exports.Computed = Computed;
exports.For = For;
exports.Memo = Memo;
exports.Reactive = Reactive;
exports.Show = Show;
exports.Switch = Switch;
exports.configureReactive = configureReactive;
exports.hasSymbol = hasSymbol;
exports.observer = observer;
exports.reactive = reactive;
exports.reactiveComponents = reactiveComponents;
exports.reactiveObserver = reactiveObserver;
exports.use$ = useSelector;
exports.useComputed = useComputed;
exports.useEffectOnce = useEffectOnce;
exports.useIsMounted = useIsMounted;
exports.useMount = useMount;
exports.useMountOnce = useMountOnce;
exports.useObservable = useObservable;
exports.useObservableReducer = useObservableReducer;
exports.useObserve = useObserve;
exports.useObserveEffect = useObserveEffect;
exports.usePauseProvider = usePauseProvider;
exports.useSelector = useSelector;
exports.useUnmount = useUnmount;
exports.useUnmountOnce = useUnmountOnce;
exports.useWhen = useWhen;
exports.useWhenReady = useWhenReady;
