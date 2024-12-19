import { Observable, computeSelector, isFunction, observable } from '@legendapp/state';
import { FieldTransforms, SyncedErrorParams, SyncedGetParams } from '@legendapp/state/sync';
import {
    CrudAsOption,
    SyncedCrudPropsBase,
    SyncedCrudPropsMany,
    SyncedCrudReturnType,
    WaitForSetCrudFnParams,
    syncedCrud,
} from '@legendapp/state/sync-plugins/crud';
import auth, { FirebaseAuthTypes } from '@react-native-firebase/auth';
import firestore, { FirebaseFirestoreTypes, query, serverTimestamp } from '@react-native-firebase/firestore';
import { invertFieldMap, transformObjectFields } from '../sync/transformObjectFields';

type Unsubscribe = () => void;

interface SyncedRNFirebaseConfiguration {
    realtime?: boolean;
    requireAuth?: boolean;
    enabled?: boolean;
}

const isEnabled$ = observable(true);

const firebaseConfig: SyncedRNFirebaseConfiguration = {} as SyncedRNFirebaseConfiguration;
export function configureSyncedFirebase(config: SyncedRNFirebaseConfiguration) {
    const { enabled, ...rest } = config;
    Object.assign(firebaseConfig, rest);
    if (enabled !== undefined) {
        isEnabled$.set(enabled);
    }
}

type WhereFilter<T> = {
    field: string & keyof T;
    operator: FirebaseFirestoreTypes.WhereFilterOp;
    value: any;
};

export interface SyncedRNFirebaseProps<TRemote extends object, TLocal, TAs extends CrudAsOption = 'value'>
    extends Omit<SyncedCrudPropsMany<TRemote, TLocal, TAs>, 'list' | 'retry'>,
        Omit<SyncedCrudPropsBase<TRemote, TLocal>, 'onError'> {
    collection: string;
    docId?: never;
    filters?: WhereFilter<TRemote>[];
    limit?: number;
    fieldTransforms?: FieldTransforms<TRemote>;
    onError?: (error: Error, params: RNFirebaseErrorParams) => void;
    // Also in global config
    realtime?: boolean;
    requireAuth?: boolean;
}
export interface SyncedRNFirebasePropsWithDocId<TRemote extends object, TLocal, TAs extends CrudAsOption = 'value'>
    extends Omit<SyncedRNFirebaseProps<TRemote, TLocal, TAs>, 'docId'> {
    docId: string;
}

interface FirebaseFns {
    serverTimestamp: () => any;
    onAuthStateChanged: (listener: (user: FirebaseAuthTypes.User | null) => void) => Unsubscribe;
    generateId: (collectionPath: string) => string;
}

export interface RNFirebaseErrorParams extends Omit<SyncedErrorParams, 'source'> {
    source: 'list' | 'get' | 'create' | 'update' | 'delete';
}

type OnErrorFn = (error: Error, params: RNFirebaseErrorParams) => void;

const fns: FirebaseFns = {
    serverTimestamp,
    onAuthStateChanged: (cb) => auth().onAuthStateChanged(cb),
    generateId: (collectionPath: string) => firestore().collection(collectionPath).doc().id,
};

export function syncedFirebase<TRemote extends object, TLocal = TRemote, TAs extends CrudAsOption = 'object'>(
    props: SyncedRNFirebaseProps<TRemote, TLocal, TAs>,
): SyncedCrudReturnType<TLocal, TAs>;
export function syncedFirebase<TRemote extends object, TLocal = TRemote, TAs extends CrudAsOption = 'object'>(
    props: SyncedRNFirebasePropsWithDocId<TRemote, TLocal, TAs>,
): SyncedCrudReturnType<TLocal, TAs>;
export function syncedFirebase<TRemote extends object, TLocal = TRemote, TAs extends CrudAsOption = 'object'>(
    props: SyncedRNFirebaseProps<TRemote, TLocal, TAs> | SyncedRNFirebasePropsWithDocId<TRemote, TLocal, TAs>,
): SyncedCrudReturnType<TLocal, TAs> {
    props = { ...firebaseConfig, ...props } as any;

    const { collection, docId, filters, limit, requireAuth, waitFor, waitForSet, ...rest } = props;

    const list = async (getParams: SyncedGetParams<TRemote>): Promise<TRemote[]> => {
        const { onError } = getParams;
        const collectionRef = firestore().collection<TRemote>(collection);

        if (docId) {
            const doc = await collectionRef
                .doc(docId)
                .get()
                .catch((error) => {
                    (onError as OnErrorFn)(error as Error, {
                        getParams,
                        source: 'list',
                        type: 'get',
                        retry: getParams,
                    });
                    return undefined;
                });
            return doc?.exists ? [doc.data() as TRemote] : [];
        }

        let q = query(collectionRef);

        if (filters) {
            filters.forEach(({ field, operator, value }) => {
                q = q.where(field, operator, value);
            });
        }

        if (limit) {
            q = q.limit(limit);
        }

        const docs = await q.get().catch((error) => {
            (onError as OnErrorFn)(error as Error, {
                getParams,
                source: 'list',
                type: 'get',
                retry: getParams,
            });
            return undefined;
        });
        return docs?.docs.map((doc) => doc.data()) || [];
    };

    let isAuthedIfRequired$: Observable<boolean> | undefined;
    if (requireAuth) {
        isAuthedIfRequired$ = observable(false);
        // TODO if needed: const unsubscribe =
        fns.onAuthStateChanged((user) => {
            isAuthedIfRequired$!.set(!!user);
        });
    }

    return syncedCrud<TRemote, TLocal, TAs>({
        ...(rest as any), // Workaround for type errors
        list,
        create: () => {},
        update: () => {},
        delete: () => {},
        waitFor: () =>
            isEnabled$.get() &&
            (isAuthedIfRequired$ ? isAuthedIfRequired$.get() : true) &&
            (waitFor ? computeSelector(waitFor) : true),
        waitForSet: (params: WaitForSetCrudFnParams<any>) =>
            isEnabled$.get() &&
            (isAuthedIfRequired$ ? isAuthedIfRequired$.get() : true) &&
            (waitForSet ? (isFunction(waitForSet) ? waitForSet(params) : waitForSet) : true),
        generateId: fns.generateId,
        transform: () => {},
    }) as SyncedCrudReturnType<TLocal, TAs>;
}
export { invertFieldMap, transformObjectFields };
export type { FieldTransforms };
