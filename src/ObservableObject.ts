import { batch, beginBatch, createPreviousHandler, endBatch, isArraySubset, notify } from './batching';
import { createObservable } from './createObservable';
import {
    checkActivate,
    extraPrimitiveActivators,
    extraPrimitiveProps,
    extractFunction,
    findIDKey,
    getChildNode,
    getNode,
    getNodeValue,
    globalState,
    isComputed,
    isObservable,
    optimized,
    setNodeValue,
    symbolActivated,
    symbolDelete,
    symbolGetNode,
    symbolOpaque,
    symbolToPrimitive,
} from './globals';
import { mergeIntoObservable } from './helpers';
import {
    hasOwnProperty,
    isArray,
    isBoolean,
    isChildNodeValue,
    isEmpty,
    isFunction,
    isObject,
    isPrimitive,
    isPromise,
} from './is';
import type {
    ActivateParams,
    Change,
    ChildNodeValue,
    GetOptions,
    ListenerParams,
    NodeValue,
    SubscribeOptions,
    TrackingType,
    UpdateFn,
} from './observableInterfaces';
import { Observable, ObservableState } from './observableTypes';
import { observe } from './observe';
import { onChange } from './onChange';
import { ObservablePersistStateInternal } from './persistTypes';
import { runWithRetry } from './retry';
import { updateTracking } from './tracking';
import { whenReady } from './when';

const noop = () => {};

const ArrayModifiers = new Set([
    'copyWithin',
    'fill',
    'from',
    'pop',
    'push',
    'reverse',
    'shift',
    'sort',
    'splice',
    'unshift',
]);
const ArrayLoopers = new Set<keyof Array<any>>([
    'every',
    'filter',
    'find',
    'findIndex',
    'forEach',
    'includes',
    'join',
    'map',
    'some',
]);
const ArrayLoopersReturn = new Set<keyof Array<any>>(['filter', 'find']);
export const observableProperties = new Map<
    string,
    { get: (node: NodeValue, ...args: any[]) => any; set: (node: NodeValue, value: any) => any }
>();
export const observableFns = new Map<string, (node: NodeValue, ...args: any[]) => any>([
    ['get', get],
    ['set', set],
    ['peek', peek],
    ['onChange', onChange],
    ['assign', assign],
    ['delete', deleteFn],
    ['toggle', toggle],
]);

if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
    // eslint-disable-next-line no-var
    var __devUpdateNodes = new Set();
}
function collectionSetter(node: NodeValue, target: any[], prop: keyof Array<any>, ...args: any[]) {
    if (prop === 'push' && args.length === 1) {
        setKey(node, target.length + '', args[0]);
    } else {
        const prevValue = target.slice();

        const ret = (target[prop] as Function).apply(target, args);

        if (node) {
            const hasParent = isChildNodeValue(node);
            const key: string = hasParent ? node.key : '_';
            const parentValue = hasParent ? getNodeValue(node.parent) : node.root;

            // Set the object to the previous value first
            parentValue[key] = prevValue;

            // Then set with the new value so it notifies with the correct prevValue
            setKey(node.parent ?? node, key, target);
        }

        // Return the original value
        return ret;
    }
}

function getKeys(obj: Record<any, any> | Array<any> | undefined, isArr: boolean, isMap: boolean): string[] {
    return isArr ? (undefined as any) : obj ? (isMap ? Array.from(obj.keys()) : Object.keys(obj)) : [];
}

function updateNodes(parent: NodeValue, obj: Record<any, any> | Array<any> | undefined, prevValue: any): boolean {
    if (
        (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') &&
        typeof __devUpdateNodes !== 'undefined' &&
        isObject(obj)
    ) {
        if (__devUpdateNodes.has(obj)) {
            console.error(
                '[legend-state] Circular reference detected in object. You may want to use opaqueObject to stop traversing child nodes.',
                obj,
            );
            return false;
        }
        __devUpdateNodes.add(obj);
    }
    if (
        (isObject(obj) && (obj as Record<any, any>)[symbolOpaque as any]) ||
        (isObject(prevValue) && prevValue[symbolOpaque as any])
    ) {
        const isDiff = obj !== prevValue;
        if (isDiff) {
            if (parent.listeners || parent.listenersImmediate) {
                notify(parent, obj, prevValue, 0);
            }
        }
        if (
            (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') &&
            typeof __devUpdateNodes !== 'undefined' &&
            obj !== undefined
        ) {
            __devUpdateNodes.delete(obj);
        }
        return isDiff;
    }

    const isArr = isArray(obj);

    let prevChildrenById: Map<string, ChildNodeValue> | undefined;
    let moved: [string, ChildNodeValue][] | undefined;

    const isMap = obj instanceof Map;
    const isPrevMap = prevValue instanceof Map;

    const keys = getKeys(obj, isArr, isMap);
    const keysPrev = getKeys(prevValue, isArr, isPrevMap);
    const length = (keys || obj)?.length || 0;
    const lengthPrev = (keysPrev || prevValue)?.length || 0;

    let idField: string | ((value: any) => string) | undefined;
    let isIdFieldFunction;
    let hasADiff = false;
    let retValue: boolean | undefined;

    if (isArr && isArray(prevValue)) {
        // Construct a map of previous indices for computing move
        if (prevValue.length > 0) {
            const firstPrevValue = prevValue[0];
            if (firstPrevValue !== undefined) {
                idField = findIDKey(firstPrevValue, parent);

                if (idField) {
                    isIdFieldFunction = isFunction(idField);
                    prevChildrenById = new Map();
                    moved = [];
                    const keysSeen: Set<string> =
                        process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test'
                            ? new Set()
                            : (undefined as unknown as Set<string>);
                    if (parent.children) {
                        for (let i = 0; i < prevValue.length; i++) {
                            const p = prevValue[i];
                            if (p) {
                                const child = parent.children.get(i + '');
                                if (child) {
                                    const key = isIdFieldFunction
                                        ? (idField as (value: any) => string)(p)
                                        : p[idField as string];

                                    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
                                        if (keysSeen.has(key)) {
                                            console.warn(
                                                `[legend-state] Warning: Multiple elements in array have the same ID. Key field: ${idField}, Array:`,
                                                prevValue,
                                            );
                                        }
                                        keysSeen.add(key);
                                    }
                                    prevChildrenById.set(key, child);
                                }
                            }
                        }
                    }
                }
            }
        }
    } else if (prevValue && (!obj || isObject(obj))) {
        // For keys that have been removed from object, notify and update children recursively
        const lengthPrev = keysPrev.length;
        for (let i = 0; i < lengthPrev; i++) {
            const key = keysPrev[i];
            if (!keys.includes(key)) {
                hasADiff = true;
                const child = getChildNode(parent, key);

                const prev = isPrevMap ? prevValue.get(key) : prevValue[key];
                if (prev !== undefined) {
                    if (!isPrimitive(prev)) {
                        updateNodes(child, undefined, prev);
                    }

                    if (child.listeners || child.listenersImmediate) {
                        notify(child, undefined, prev, 0);
                    }
                }
            }
        }
    }

    if (obj && !isPrimitive(obj)) {
        hasADiff = hasADiff || length !== lengthPrev;
        const isArrDiff = hasADiff;
        let didMove = false;

        for (let i = 0; i < length; i++) {
            const key = isArr ? i + '' : keys[i];
            let value = isMap ? obj.get(key) : (obj as any)[key];
            const prev = isPrevMap ? prevValue?.get(key) : prevValue?.[key];

            let isDiff = value !== prev;
            if (isDiff) {
                const id =
                    idField && value
                        ? isIdFieldFunction
                            ? (idField as (value: any) => string)(value)
                            : value[idField as string]
                        : undefined;

                if (isObservable(value)) {
                    const obs = value;
                    value = () => obs;
                }
                let child = getChildNode(parent, key, isFunction(value) ? value : undefined);

                if (!child.lazy && (isFunction(value) || isObservable(value))) {
                    reactivateNode(child, value);
                    peek(child);
                }

                // Detect moves within an array. Need to move the original proxy to the new position to keep
                // the proxy stable, so that listeners to this node will be unaffected by the array shift.
                if (isArr && id !== undefined) {
                    // Find the previous position of this element in the array
                    const prevChild = id !== undefined ? prevChildrenById?.get(id) : undefined;
                    if (!prevChild) {
                        // This id was not in the array before so it does not need to notify children
                        isDiff = false;
                        hasADiff = true;
                    } else if (prevChild !== undefined && prevChild.key !== key) {
                        const valuePrevChild = prevValue[prevChild.key];
                        // If array length changed then move the original node to the current position.
                        // That should be faster than notifying every single element that
                        // it's in a new position.
                        if (isArrDiff) {
                            child = prevChild;
                            parent.children!.delete(child.key);
                            child.key = key;
                            moved!.push([key, child]);
                        }

                        didMove = true;

                        // And check for diff against the previous value in the previous position
                        isDiff = valuePrevChild !== value;
                    }
                }

                if (isDiff) {
                    // Array has a new / modified element
                    // If object iterate through its children
                    if (isFunction(value) || isObservable(value)) {
                        extractFunctionOrComputed(parent, obj, key, value);
                    } else if (isPrimitive(value)) {
                        hasADiff = true;
                    } else {
                        // Always need to updateNodes so we notify through all children
                        const updatedNodes = updateNodes(child, value, prev);
                        hasADiff = hasADiff || updatedNodes;
                    }
                }
                if (isDiff || !isArrDiff) {
                    // Notify for this child if this element is different and it has listeners
                    // Or if the position changed in an array whose length did not change
                    // But do not notify child if the parent is an array with changing length -
                    // the array's listener will cover it
                    if (child.listeners || child.listenersImmediate) {
                        notify(child, value, prev, 0, !isArrDiff);
                    }
                }
            }
        }

        if (moved) {
            for (let i = 0; i < moved.length; i++) {
                const [key, child] = moved[i];
                parent.children!.set(key, child);
            }
        }

        // The full array does not need to re-render if the length is the same
        // So don't notify shallow listeners
        retValue = hasADiff || didMove;
    } else if (prevValue !== undefined) {
        // If value got set to undefined, it has a diff
        retValue = true;
    }

    if (
        (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') &&
        typeof __devUpdateNodes !== 'undefined' &&
        obj !== undefined
    ) {
        __devUpdateNodes.delete(obj);
    }
    return retValue ?? false;
}

export function getProxy(node: NodeValue, p?: string, asFunction?: Function): Observable {
    // Get the child node if p prop
    if (p !== undefined) node = getChildNode(node, p, asFunction);

    // Create a proxy if not already cached and return it
    return (node.proxy || (node.proxy = new Proxy<NodeValue>(node, proxyHandler))) as Observable<any>;
}

export function flushPending() {
    // Need to short circuit the computed batching because the user called get() or peek()
    // in which case the set needs to run immediately so that the values are up to date.
    if (globalState.pendingNodes.size > 0) {
        const nodes = Array.from(globalState.pendingNodes.values());
        globalState.pendingNodes.clear();
        nodes.forEach((fn) => fn());
    }
}

const proxyHandler: ProxyHandler<any> = {
    get(node: NodeValue, p: any, receiver: any) {
        if (p === symbolToPrimitive) {
            throw new Error(
                process.env.NODE_ENV === 'development'
                    ? '[legend-state] observable should not be used as a primitive. You may have forgotten to use .get() or .peek() to get the value of the observable.'
                    : '[legend-state] observable is not a primitive.',
            );
        }
        if (p === symbolGetNode) {
            return node;
        }

        const value = peek(node);

        // If this node is linked to another observable then forward to the target's handler.
        // The exception is onChange because it needs to listen to this node for changes.
        // This needs to be below peek because it activates there.
        if (node.linkedToNode && p !== 'onChange') {
            updateTracking(node);
            return proxyHandler.get!(node.linkedToNode, p, receiver);
        }

        if (value instanceof Map || value instanceof WeakMap || value instanceof Set || value instanceof WeakSet) {
            const ret = handlerMapSet(node, p, value);
            if (ret !== undefined) {
                return ret;
            }
        }

        const fn = observableFns.get(p);
        // If this is an observable function, call it
        if (fn) {
            if (p === 'get' || p === 'peek') {
                flushPending();
            }
            return function (a: any, b: any, c: any) {
                const l = arguments.length;

                // Array call and apply are slow so micro-optimize this hot path.
                // The observable functions depends on the number of arguments so we have to
                // call it with the correct arguments, not just undefined
                switch (l) {
                    case 0:
                        return fn(node);
                    case 1:
                        return fn(node, a);
                    case 2:
                        return fn(node, a, b);
                    default:
                        return fn(node, a, b, c);
                }
            };
        }

        if (node.isComputed) {
            if (node.proxyFn && !fn) {
                return node.proxyFn(p);
            } else {
                checkActivate(node);
            }
        }

        const property = observableProperties.get(p);
        if (property) {
            return property.get(node);
        }

        // TODOV3 Remove this
        const isValuePrimitive = isPrimitive(value);

        // If accessing a key that doesn't already exist, and this node has been activated with extra keys
        // then return the values that were set. This is used by enableLegendStateReact for example.
        if (value === undefined || value === null || isValuePrimitive) {
            if (extraPrimitiveProps.size && (node.isActivatedPrimitive || extraPrimitiveActivators.has(p))) {
                node.isActivatedPrimitive = true;
                const vPrim = extraPrimitiveProps.get(p);
                if (vPrim !== undefined) {
                    return isFunction(vPrim) ? vPrim(getProxy(node)) : vPrim;
                }
            }
        }
        // /TODOV3 Remove this

        const vProp = value?.[p];

        if (isObject(value) && value[symbolOpaque as any]) {
            return vProp;
        }

        const fnOrComputed = node.functions?.get(p);
        if (fnOrComputed) {
            if (isObservable(fnOrComputed)) {
                return fnOrComputed;
            } else {
                return getProxy(node, p, fnOrComputed as Function);
            }
        }

        // Handle function calls
        if (isFunction(vProp)) {
            if (isArray(value)) {
                if (ArrayModifiers.has(p)) {
                    // Call the wrapped modifier function
                    return (...args: any[]) => collectionSetter(node, value, p, ...args);
                } else if (ArrayLoopers.has(p)) {
                    // Update that this node was accessed for observers
                    updateTracking(node);

                    return function (cbOrig: any, thisArg: any) {
                        // If callback needs to run on the observable proxies, use a wrapped callback
                        function cbWrapped(_: any, index: number, array: any[]) {
                            return cbOrig(getProxy(node, index + ''), index, array);
                        }

                        // If return value needs to be observable proxies, use our own looping logic and return the proxy when found
                        if (ArrayLoopersReturn.has(p)) {
                            const isFind = p === 'find';
                            const out = [];
                            for (let i = 0; i < value.length; i++) {
                                if (cbWrapped(value[i], i, value)) {
                                    const proxy = getProxy(node, i + '');
                                    if (isFind) {
                                        return proxy;
                                    } else {
                                        out.push(proxy);
                                    }
                                }
                            }
                            return isFind ? undefined : out;
                        } else {
                            return value[p](cbWrapped, thisArg);
                        }
                    };
                }
            }
            // Return the function bound to the value
            return vProp.bind(value);
        }

        // Accessing primitive returns the raw value
        if (isPrimitive(vProp)) {
            // Update that this primitive node was accessed for observers
            if (isArray(value) && p === 'length') {
                updateTracking(node, true);
                return vProp;
            }
        }

        // Return an observable proxy to the property
        return getProxy(node, p);
    },
    // Forward all proxy properties to the target's value
    getPrototypeOf(node: NodeValue) {
        const value = getNodeValue(node);
        return value !== null && typeof value === 'object' ? Reflect.getPrototypeOf(value) : null;
    },
    ownKeys(node: NodeValue) {
        const value = getNodeValue(node);
        if (isPrimitive(value)) return [];

        const keys = value ? Reflect.ownKeys(value) : [];

        // Update that this node was accessed for observers
        updateTracking(node, true);

        // This is required to fix this error:
        // TypeError: 'getOwnPropertyDescriptor' on proxy: trap reported non-configurability for
        // property 'length' which is either non-existent or configurable in the proxy node
        if (isArray(value) && keys[keys.length - 1] === 'length') {
            keys.splice(keys.length - 1, 1);
        }
        return keys;
    },
    getOwnPropertyDescriptor(node: NodeValue, prop: string) {
        const value = getNodeValue(node);
        return !isPrimitive(value) ? Reflect.getOwnPropertyDescriptor(value, prop) : undefined;
    },
    set(node: NodeValue, prop: string, value: any) {
        // If this assignment comes from within an observable function it's allowed
        if (node.isSetting) {
            return Reflect.set(node, prop, value);
        }
        if (node.isAssigning) {
            setKey(node, prop, value);
            return true;
        }

        const property = observableProperties.get(prop);
        if (property) {
            property.set(node, value);
            return true;
        }

        if (process.env.NODE_ENV === 'development') {
            console.warn('[legend-state]: Error: Cannot set a value directly:', prop, value);
        }
        return false;
    },
    deleteProperty(node: NodeValue, prop: string) {
        // If this delete comes from within an observable function it's allowed
        if (node.isSetting) {
            return Reflect.deleteProperty(node, prop);
        } else {
            if (process.env.NODE_ENV === 'development') {
                console.warn('[legend-state]: Error: Cannot delete a value directly:', prop);
            }
            return false;
        }
    },
    has(node: NodeValue, prop: string) {
        const value = getNodeValue(node);
        return Reflect.has(value, prop);
    },
    apply(target, thisArg, argArray) {
        // If it's a function call it as a function
        return Reflect.apply(target.lazyFn || target, thisArg, argArray);
    },
};

export function set(node: NodeValue, newValue?: any): Observable {
    if (node.parent) {
        return setKey(node.parent, node.key, newValue);
    } else {
        return setKey(node, '_', newValue);
    }
}
function toggle(node: NodeValue) {
    const value = getNodeValue(node);
    if (value === undefined || value === null || isBoolean(value)) {
        set(node, !value);
        return !value;
    } else if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
        throw new Error('[legend-state] Cannot toggle a non-boolean value');
    }
}

function setKey(node: NodeValue, key: string, newValue?: any, level?: number): Observable {
    if (process.env.NODE_ENV === 'development') {
        if (typeof HTMLElement !== 'undefined' && newValue instanceof HTMLElement) {
            console.warn(`[legend-state] Set an HTMLElement into state. You probably don't want to do that.`);
        }
    }

    const isRoot = !node.parent && key === '_';

    // TODOv3 root locking will be removed with old computeds
    if (node.root.locked && !node.root.set) {
        // This happens when modifying a locked observable such as a computed.
        // If merging this could be happening deep in a hierarchy so we don't want to throw errors so we'll just do nothing.
        // This could happen during persistence local load for example.
        if (globalState.isMerging) {
            return isRoot ? getProxy(node) : getProxy(node, key);
        } else {
            throw new Error(
                process.env.NODE_ENV === 'development'
                    ? '[legend-state] Cannot modify an observable while it is locked. Please make sure that you unlock the observable before making changes.'
                    : '[legend-state] Modified locked observable',
            );
        }
    }

    if (node.parent && !getNodeValue(node)) {
        return set(node, { [key]: newValue });
    }

    // Get the child node for updating and notifying
    const childNode: NodeValue = isRoot ? node : getChildNode(node, key, isFunction(newValue) ? newValue : undefined);

    if (isObservable(newValue)) {
        setToObservable(childNode, newValue);
    } else {
        // Set the raw value on the parent object
        const { newValue: savedValue, prevValue, parentValue } = setNodeValue(childNode, newValue);

        const isFunc = isFunction(savedValue);

        const isPrim = isPrimitive(savedValue) || savedValue instanceof Date;

        if (savedValue !== prevValue) {
            updateNodesAndNotify(node, savedValue, prevValue, childNode, isPrim, isRoot, level);
        }

        if (!isPrim) {
            childNode.needsExtract = true;
        }

        extractFunctionOrComputed(node, parentValue, key, savedValue);

        if (isFunc) {
            return savedValue;
        }
    }

    return isRoot ? getProxy(node) : getProxy(node, key);
}

function assign(node: NodeValue, value: any) {
    const proxy = getProxy(node);

    beginBatch();

    if (isPrimitive(node.root._)) {
        node.root._ = {};
    }

    // Set inAssign to allow setting on safe observables
    node.isAssigning = (node.isAssigning || 0) + 1;
    try {
        Object.assign(proxy, value);
    } finally {
        node.isAssigning--;
    }

    endBatch();

    return proxy;
}

function deleteFn(node: NodeValue, key?: string) {
    // If called without a key, delete by key from the parent node
    if (key === undefined && isChildNodeValue(node)) {
        key = node.key;
        node = node.parent;
    }
    setKey(node, key ?? '_', symbolDelete, /*level*/ -1);
}

function handlerMapSet(node: NodeValue, p: any, value: Map<any, any> | WeakMap<any, any> | Set<any> | WeakSet<any>) {
    const vProp = (value as any)?.[p];
    if (p === 'size') {
        return getProxy(node, p);
    } else if (isFunction(vProp)) {
        return function (a: any, b: any, c: any) {
            const l = arguments.length;
            const valueMap = value as Map<any, any>;

            if (p === 'get') {
                if (l > 0 && typeof a !== 'boolean' && a !== optimized) {
                    return getProxy(node, a);
                }
            } else if (p === 'set') {
                if (l === 2) {
                    const prev = valueMap.get(a);
                    const ret = valueMap.set(a, b);
                    if (prev !== b) {
                        updateNodesAndNotify(getChildNode(node, a), b, prev);
                    }
                    return ret;
                }
            } else if (p === 'delete') {
                if (l > 0) {
                    // Support Set by just returning a if it doesn't have get, meaning it's not a Map
                    const prev = (value as Map<any, any>).get ? valueMap.get(a) : a;
                    const ret = value.delete(a);
                    if (ret) {
                        updateNodesAndNotify(getChildNode(node, a), undefined, prev);
                    }
                    return ret;
                }
            } else if (p === 'clear') {
                const prev = new Map(valueMap);
                const size = valueMap.size;
                valueMap.clear();
                if (size) {
                    updateNodesAndNotify(node, value, prev);
                }
                return;
            } else if (p === 'add') {
                const prev = new Set(value as unknown as Set<any>);
                const ret = (value as unknown as Set<any>).add(a);
                if (!(value as unknown as Set<any>).has(p)) {
                    notify(node, ret, prev, 0);
                }
                return ret;
            }

            // TODO: This is duplicated from proxy handler, how to dedupe with best performance?
            const fn = observableFns.get(p);
            if (fn) {
                // Array call and apply are slow so micro-optimize this hot path.
                // The observable functions depends on the number of arguments so we have to
                // call it with the correct arguments, not just undefined
                switch (l) {
                    case 0:
                        return fn(node);
                    case 1:
                        return fn(node, a);
                    case 2:
                        return fn(node, a, b);
                    default:
                        return fn(node, a, b, c);
                }
            } else {
                return (value as any)[p](a, b);
            }
        };
    }
}

function updateNodesAndNotify(
    node: NodeValue,
    newValue: any,
    prevValue: any,
    childNode?: NodeValue,
    isPrim?: boolean,
    isRoot?: boolean,
    level?: number,
) {
    if (!childNode) childNode = node;
    // Make sure we don't call too many listeners for every property set
    beginBatch();

    let hasADiff = isPrim;
    let whenOptimizedOnlyIf = false;
    // If new value is an object or array update notify down the tree
    if (!isPrim || (prevValue && !isPrimitive(prevValue))) {
        if (
            (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') &&
            typeof __devUpdateNodes !== 'undefined'
        ) {
            __devUpdateNodes.clear();
        }
        hasADiff = updateNodes(childNode, newValue, prevValue);
        if (isArray(newValue)) {
            whenOptimizedOnlyIf = newValue?.length !== prevValue?.length;
        }
    }

    if (isPrim || !newValue || (isEmpty(newValue) && !isEmpty(prevValue)) ? newValue !== prevValue : hasADiff) {
        // Notify for this element if something inside it has changed
        notify(
            isPrim && isRoot ? node : childNode,
            newValue,
            prevValue,
            level ?? prevValue === undefined ? -1 : hasADiff ? 0 : 1,
            whenOptimizedOnlyIf,
        );
    }

    endBatch();
}

export function extractPromise(node: NodeValue, value: Promise<any>, setter?: (params: { value: any }) => void) {
    if (!node.state) {
        node.state = createObservable<ObservableState>(
            {
                isLoaded: false,
            } as ObservableState,
            false,
            extractPromise,
            getProxy,
        ) as any;
    }

    value
        .then((value) => {
            setter ? setter({ value }) : set(node, value);
            node.state!.assign({
                isLoaded: true,
                error: undefined,
            });
        })
        .catch((error) => {
            node.state!.error.set(error);
        });
}

export function extractFunctionOrComputed(node: NodeValue, obj: Record<string, any>, k: string, v: any) {
    if (isPromise(v)) {
        const childNode = getChildNode(node, k);
        extractPromise(childNode, v);
        setNodeValue(childNode, undefined);
    } else if (isObservable(v) && !isComputed(v)) {
        const value = getNodeValue(node);
        value[k] = () => v;
        extractFunction(node, k, value[k] as any);
    } else if (typeof v === 'function') {
        const childNode = node.children?.get(k);
        extractFunction(node, k, v);
        // If child was previously activated, then peek the new linked observable to make sure it's activated
        if (childNode && !childNode.lazy) {
            if (isObservable(v)) {
                const vNode = getNode(v);
                peek(vNode);
            }
        }
    } else if (typeof v == 'object' && v !== null && v !== undefined) {
        const childNode = getNode(v);
        if (childNode?.isComputed) {
            extractFunction(node, k, v, childNode);
        } else if (isObservable(v)) {
            extractFunction(node, k, v as any);
        } else {
            return true;
        }
    }
}

export function get(node: NodeValue, options?: TrackingType | GetOptions) {
    const track = options ? (isObject(options) ? (options.shallow as TrackingType) : options) : undefined;
    // Track by default
    updateTracking(node, track);

    return peek(node);
}

export function peek(node: NodeValue) {
    if (node.dirtyFn) {
        node.dirtyFn();
        globalState.dirtyNodes.delete(node);
        node.dirtyFn = undefined;
    }
    let value = getNodeValue(node);

    // If node is not yet lazily computed go do that
    const lazy = node.lazy;
    if (lazy) {
        const lazyFn = node.lazyFn!;
        delete node.lazy;
        if (isFunction(node) || isFunction(lazyFn)) {
            if (node.parent) {
                const parentValue = getNodeValue(node.parent);
                if (parentValue) {
                    delete parentValue[node.key];
                }
            }

            value = activateNodeFunction(node as any, lazyFn);
        }
    }

    if (lazy || node.needsExtract) {
        for (const key in value) {
            if (hasOwnProperty.call(value, key)) {
                extractFunctionOrComputed(node, value, key, value[key]);
            }
        }
    }

    // Check if computed needs to activate
    checkActivate(node);

    return value;
}

function reactivateNode(node: NodeValue, lazyFn: Function) {
    node.activatedObserveDispose?.();
    node.activatedObserveDispose = undefined;
    node.linkedToNodeDispose?.();
    node.linkedToNodeDispose = undefined;
    node.linkedToNode = undefined;
    node.lazyFn = lazyFn;
    node.lazy = true;
}

function activateNodeFunction(node: NodeValue, lazyFn: Function) {
    // let prevTarget$: Observable<any>;
    // let curTarget$: Observable<any>;
    let update: UpdateFn;
    let wasPromise: boolean | undefined;
    let ignoreThisUpdate: boolean | undefined;
    const activateFn = lazyFn;
    const doRetry = () => (node.state as Observable<ObservablePersistStateInternal>)?.refreshNum.set((v) => v + 1);
    let activatedValue;
    let disposes: (() => void)[] = [];
    let refreshFn: () => void;
    function markDirty() {
        node.dirtyFn = refreshFn;
        globalState.dirtyNodes.add(node);
    }

    node.activatedObserveDispose = observe(
        () => {
            // const params = createNodeActivationParams(node);
            // Run the function at this node
            let value = activateFn();

            // If target is an observable, make this node a link to it
            if (isObservable(value)) {
                value = setToObservable(node, value);
            }

            if (isFunction(value)) {
                value = value();
            }
            const activated = value?.[symbolActivated] as ActivateParams;
            if (activated) {
                node.activationState = activated;
                value = undefined;
            }
            ignoreThisUpdate = false;
            wasPromise = isPromise(value);

            // Activate this node if not activated already (may be called recursively)
            // TODO: Is calling recursively bad? If so can it be fixed?
            if (!node.activated) {
                node.activated = true;
                const isCached = !!node.activationState?.cache;
                wasPromise = wasPromise || !!isCached;
                const activateNodeFn = wasPromise ? globalState.activateNode : activateNodeBase;
                const { update: newUpdate, value: newValue } = activateNodeFn(node, doRetry, !!wasPromise, value);
                update = newUpdate;
                value = newValue ?? activated?.initial;
            } else if (node.activationState) {
                if (!node.activationState!.persistedRetry && !node.activationState.waitFor) {
                    const activated = node.activationState!;
                    if (node.state?.peek()?.sync) {
                        node.state.sync();
                        ignoreThisUpdate = true;
                    } else {
                        value =
                            activated.get?.({
                                updateLastSync: noop,
                                setMode: noop,
                                lastSync: undefined,
                                value: undefined,
                                refresh: doRetry,
                            }) ?? activated.initial;
                    }
                } else {
                    ignoreThisUpdate = true;
                }
            }
            // value is undefined if it's in a persisted retry
            wasPromise = wasPromise || isPromise(value);

            get(getNode((node.state as Observable<ObservablePersistStateInternal>)?.refreshNum));

            return value;
        },
        (e) => {
            if (!ignoreThisUpdate) {
                const { value, nodes, refresh } = e;
                refreshFn = refresh;
                if (!wasPromise || !globalState.isLoadingRemote$.peek()) {
                    if (wasPromise) {
                        if (node.activationState) {
                            const { initial } = node.activationState!;

                            if (value && isPromise(value)) {
                                // Extract the promise to make it set the value/error when it comes in
                                extractPromise(node, value, update);
                            }
                            // Set this to undefined only if it's replacing the activation function,
                            // so we don't overwrite it if it already has real data from either local
                            // cache or a previous run
                            if (isFunction(getNodeValue(node))) {
                                setNodeValue(node, initial ?? undefined);
                            }
                        } else if (node.activated) {
                            // Extract the promise to make it set the value/error when it comes in
                            extractPromise(node, value, update);
                            // Set this to undefined only if it's replacing the activation function,
                            // so we don't overwrite it if it already has real data from either local
                            // cache or a previous run
                            if (isFunction(getNodeValue(node))) {
                                setNodeValue(node, undefined);
                            }
                        }
                    } else {
                        activatedValue = value;
                        if (node.state!.isLoaded.peek()) {
                            set(node, value);
                        } else {
                            setNodeValue(node, value);
                            node.state!.assign({
                                isLoaded: true,
                                error: undefined,
                            });
                        }
                    }
                }

                disposes.forEach((fn) => fn());
                disposes = [];
                nodes?.forEach(({ node }) => {
                    disposes.push(onChange(node, markDirty, { immediate: true }));
                });
            }
            e.cancel = true;
        },
        { fromComputed: true },
    );
    return activatedValue;
}

const activateNodeBase = (globalState.activateNode = function activateNodeBase(
    node: NodeValue,
    refresh: () => void,
    wasPromise: boolean,
    value: any,
) {
    if (!node.state) {
        node.state = createObservable<ObservableState>(
            {
                isLoaded: false,
            } as ObservableState,
            false,
            extractPromise,
            getProxy,
        ) as any;
    }
    let isSetting = false;
    let isSettingFromSubscribe = false;
    let _mode: 'assign' | 'set' | 'merge' = 'set';
    if (node.activationState) {
        const { onSet, subscribe, get: getFn, initial } = node.activationState;

        value = getFn
            ? runWithRetry(node, { attemptNum: 0 }, () => {
                  return getFn!({
                      updateLastSync: noop,
                      setMode: (mode) => (_mode = mode),
                      lastSync: undefined,
                      value: undefined,
                      refresh,
                  });
              })
            : undefined;
        // TODO Should this have lastSync and value somehow?

        if (value == undefined || value === null) {
            value = initial;
        }

        if (onSet) {
            let allChanges: Change[] = [];
            let latestValue: any = undefined;
            let runNumber = 0;
            const runChanges = (listenerParams?: ListenerParams) => {
                // Don't call the set if this is the first value coming in
                if (allChanges.length > 0) {
                    let changes: Change[];
                    let value: any;
                    let getPrevious: () => any;
                    if (listenerParams) {
                        changes = listenerParams.changes;
                        value = listenerParams.value;
                        getPrevious = listenerParams.getPrevious;
                    } else {
                        // If this is called by flushPending then get the change array
                        // that we've been building up.
                        changes = allChanges;
                        value = latestValue;
                        getPrevious = createPreviousHandler(value, changes);
                    }
                    allChanges = [];
                    latestValue = undefined;
                    globalState.pendingNodes.delete(node);

                    runNumber++;
                    const thisRunNumber = runNumber;

                    const run = () => {
                        if (thisRunNumber !== runNumber) {
                            // set may get called multiple times before it loads so ignore any previous runs
                            return;
                        }

                        const retryAttempts = { attemptNum: 0 };
                        return runWithRetry(node, retryAttempts, (eventRetry) => {
                            const cancelRetry = () => {
                                eventRetry.cancel = true;
                            };
                            return new Promise<void>((resolve, reject) => {
                                isSetting = true;
                                let isProm = false;
                                batch(
                                    () => {
                                        try {
                                            const val = onSet({
                                                value,
                                                changes,
                                                getPrevious,
                                                node,
                                                update,
                                                refresh,
                                                retryNum: retryAttempts.attemptNum,
                                                cancelRetry,
                                                fromSubscribe: isSettingFromSubscribe,
                                            });
                                            isProm = isPromise(val);
                                            if (isProm) {
                                                (val as Promise<any>).then(resolve).catch(reject);
                                            }
                                        } catch (e) {
                                            reject(e);
                                        }
                                    },
                                    () => {
                                        if (!isProm) {
                                            isSetting = false;
                                            resolve();
                                        }
                                    },
                                );
                            });
                        });
                    };
                    whenReady(node.state!.isLoaded, run);
                }
            };

            const onChangeImmediate = ({ value, changes }: ListenerParams) => {
                if (!isSetting || isSettingFromSubscribe) {
                    if (changes.length > 1 || !isFunction(changes[0].prevAtPath)) {
                        latestValue = value;
                        if (allChanges.length > 0) {
                            changes = changes.filter((change) => !isArraySubset(allChanges[0].path, change.path));
                        }
                        allChanges.push(...changes);
                        globalState.pendingNodes.set(node, runChanges);
                    }
                }
            };

            // Create an immediate listener to mark this node as pending. Then actually run
            // the changes at the end of the batch so everything is properly batched.
            // However, this can be short circuited if the user calls get() or peek()
            // in which case the set needs to run immediately so that the values are up to date.
            onChange(node, onChangeImmediate as any, { immediate: true });
            onChange(node, runChanges);
        }
        if (process.env.NODE_ENV === 'development' && node.activationState!.cache) {
            // TODO Better message
            console.log('[legend-state] Using cache without setting up persistence first');
        }
        if (process.env.NODE_ENV === 'development' && node.activationState!.retry) {
            // TODO Better message
            console.log('[legend-state] Using retry without setting up persistence first');
        }

        if (subscribe) {
            const updateFromSubscribe: UpdateFn = (params) => {
                whenReady(node.state!.isLoaded, () => {
                    isSettingFromSubscribe = true;
                    update(params);
                    isSettingFromSubscribe = false;
                });
            };
            subscribe({ node, update: updateFromSubscribe, refresh } as SubscribeOptions);
        }
    }
    const update: UpdateFn = ({ value, mode }) => {
        // TODO: This isSetting might not be necessary? Tests still work if removing it.
        // Write tests that would break it if removed? I'd guess a combination of subscribe and
        if (!isSetting) {
            isSetting = true;
            if (_mode === 'assign' || mode === 'assign') {
                assign(node, value);
            } else if (_mode === 'merge' || mode === 'merge') {
                mergeIntoObservable(getProxy(node), value);
            } else {
                set(node, value);
            }
            isSetting = false;
        }
    };
    return { update, value };
});

function setToObservable(node: NodeValue, value: any) {
    // If the computed is a proxy to another observable
    // link it to the target observable
    const linkedNode = getNode(value);
    if (linkedNode !== node) {
        const prevNode = node.linkedToNode;
        node.linkedToNode = linkedNode;
        if (!linkedNode.linkedFromNodes) {
            linkedNode.linkedFromNodes = new Set();
        }
        linkedNode.linkedFromNodes.add(node);
        peek(linkedNode);
        node.linkedToNodeDispose?.();
        node.linkedToNodeDispose = onChange(
            linkedNode,
            () => {
                value = peek(linkedNode);
                set(node, value);
            },
            { initial: true },
        );

        // If the target observable is different then notify for the change
        if (prevNode) {
            const value = getNodeValue(linkedNode);
            const prevValue = getNodeValue(prevNode);
            notify(node, value, prevValue, 0);
        }
    }
    return value;
}
