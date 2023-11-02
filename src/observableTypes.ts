import type { ListenerFn, ObservableBaseFns, TrackingType } from './observableInterfaces';

/* branded types */
export declare const __brand: unique symbol;
export declare const __type: unique symbol;

export type Brand<K, T> = { [__brand]: T; __type: K };
type None = Brand<never, 'None'>;
export type Activator<T> = Brand<T, 'Activator'>;

type Primitive = string | number | boolean | symbol | bigint | undefined | null | Date;
type ArrayOverrideFnNames = 'find' | 'every' | 'some' | 'filter' | 'reduce' | 'reduceRight' | 'forEach' | 'map';

type ObservableComputed<T = any> = Readonly<Observable<T>>;
type ObservableComputedTwoWay<T, T2> = Observable<T> & MutableObservableBase<T2, T2>;

type MakeReadonlyInner<T> = Omit<T, keyof MutableObservableBase<any, any>>;
type Readonly<T> = MakeReadonlyInner<T> & {
    [K in keyof MakeReadonlyInner<T>]: T extends Observable ? T[K] : Readonly<T[K]>;
};

type RemoveIndex<T> = {
    [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K];
};

interface ObservableArray<T, U>
    extends ObservablePrimitive<T>,
        Pick<Array<Observable<U>>, ArrayOverrideFnNames>,
        Omit<RemoveIndex<Array<U>>, ArrayOverrideFnNames> {}

interface ObservableObjectFns<T, T2 = T> {
    assign(value: Partial<T & T2>): Observable<T>;
}
// TODO asdf Might not need T2
interface ObservableObject<T = Record<string, any>, T2 = T>
    extends ObservablePrimitive<T, T2>,
        ObservableObjectFns<T, T2> {}

type ObservableMap<T extends Map<any, any> | WeakMap<any, any>> = Omit<T, 'get' | 'size'> &
    Omit<ObservablePrimitive<T>, 'get' | 'size'> & {
        get(key: Parameters<T['get']>[0]): Observable<Parameters<T['set']>[1]>;
        get(): T;
        size: ImmutableObservableBase<number>;
    };

type ObservableSet<T extends Set<any> | WeakSet<any>> = Omit<T, 'size'> &
    Omit<ObservablePrimitive<T>, 'size'> & { size: ImmutableObservableBase<number> };

interface ObservableBoolean extends ObservablePrimitive<boolean> {
    toggle(): boolean;
}

interface ObservablePrimitive<T, T2 = T> extends ImmutableObservableBase<T>, MutableObservableBase<T, T2> {}
type ObservableAny = Partial<ObservableObjectFns<any>> & ObservablePrimitive<any>;

interface ImmutableObservableBase<T> {
    peek(): T;
    get(trackingType?: TrackingType): T;
    onChange(
        cb: ListenerFn<T>,
        options?: { trackingType?: TrackingType; initial?: boolean; immediate?: boolean; noArgs?: boolean },
    ): () => void;
}

interface MutableObservableBase<T, T2> {
    set(value: (T & T2) | Promise<T & T2> | ((prev: T & T2) => T & T2) | Observable<T & T2>): Observable<T>;
    delete(): void;
}

type UndefinedIf<T, U> = U extends true ? T | undefined : T;

type IsNullable<T> = undefined extends T ? true : null extends T ? true : false;

type NonObservable = Function | Observable;
type NonObservableKeys<T> = {
    [K in keyof T]-?: IsStrictAny<T[K]> extends true
        ? never
        : T[K] extends undefined | null
        ? never
        : NonNullable<T[K]> extends NonObservable
        ? K
        : never;
}[keyof T];
type ObservableProps<T> = RestoreNullability<T, Simplify<Omit<NonNullable<T>, NonObservableKeys<NonNullable<T>>>>>;

type NonObservableProps<T> = RestoreNullability<
    T,
    Simplify<NullablePropsIf<Pick<NonNullable<T>, NonObservableKeys<NonNullable<T>>>, IsNullable<T>>>
>;
type NullablePropsIf<T, U> = {
    [K in keyof T]: UndefinedIf<T[K], U>;
};

type RestoreNullability<Source, Target> = IsNullable<Source> extends true
    ? Target | Extract<Source, null | undefined>
    : Target;

type ObservableChildren<T, Nullable = IsNullable<T>> = {
    [K in keyof T]-?: Observable<UndefinedIf<T[K], Nullable>>;
};
type ObservableFunctionChildren<T> = {
    [K in keyof T]-?: T[K] extends Observable
        ? T[K]
        : T[K] extends () => Promise<infer t> | infer t
        ? t extends void
            ? T[K]
            : ObservableComputed<t> & T[K]
        : T[K];
};

type IsStrictAny<T> = 0 extends 1 & T ? true : false;

interface ObservableState {
    isLoaded: boolean;
    error?: Error;
}
interface WithState {
    state: ObservableState; // TODOV3: remove this
    _state: ObservableState;
}

type ObservableNode<T, NT = NonNullable<T>> = [NT] extends [never] // means that T is ONLY undefined or null
    ? ObservablePrimitive<T>
    : IsStrictAny<T> extends true
    ? ObservableAny
    : [NT] extends [Promise<infer t>]
    ? Observable<t> & Observable<WithState>
    : [T] extends [() => infer t]
    ? t extends Observable
        ? t
        : ObservableComputed<t>
    : [NT] extends [ImmutableObservableBase<any>]
    ? NT
    : [NT] extends [Primitive]
    ? [NT] extends [boolean]
        ? ObservableBoolean
        : ObservablePrimitive<T>
    : // : [NT] extends [Computed<infer U, infer U2>]
    // ? U2 extends None
    //     ? ObservableComputed<U>
    //     : ObservableComputedTwoWay<U, U2>
    NT extends Map<any, any> | WeakMap<any, any>
    ? ObservableMap<NT>
    : NT extends Set<infer U>
    ? ObservableSet<Set<UndefinedIf<U, IsNullable<T>>>>
    : NT extends WeakSet<any>
    ? ObservableSet<NT> // TODO what to do here with nullable? WeakKey is type object | symbol
    : NT extends Array<infer U>
    ? ObservableArray<T, U> & ObservableChildren<T>
    : ObservableObject<ObservableProps<T> & NonObservableProps<T>> &
          ObservableChildren<ObservableProps<T>> &
          ObservableFunctionChildren<NonObservableProps<T>>;

type Simplify<T> = { [K in keyof T]: T[K] } & {};
type Observable<T = any> = ObservableNode<T>; // & {};

type ObservableReadable<T = any> = ImmutableObservableBase<T>;
type ObservableWriteable<T = any> = MutableObservableBase<T, T>;

export type {
    ObservableComputed,
    ObservableComputedTwoWay,
    Observable,
    ObservableBoolean,
    ObservableObject,
    ObservablePrimitive,
    ObservableReadable,
    ObservableWriteable,
    // TODO: how to make these internal somehow?
    ImmutableObservableBase,
};
