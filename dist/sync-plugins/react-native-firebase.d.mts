import { FieldTransforms, SyncedErrorParams } from '@legendapp/state/sync';
export { FieldTransforms } from '@legendapp/state/sync';
import { CrudAsOption, SyncedCrudPropsMany, SyncedCrudPropsBase, SyncedCrudReturnType } from '@legendapp/state/sync-plugins/crud';
import { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';
export { i as invertFieldMap, t as transformObjectFields } from '../transformObjectFields-BPLpgcuI.mjs';

interface SyncedRNFirebaseConfiguration {
    realtime?: boolean;
    requireAuth?: boolean;
    enabled?: boolean;
}
declare function configureSyncedFirebase(config: SyncedRNFirebaseConfiguration): void;
type WhereFilter<T> = {
    field: string & keyof T;
    operator: FirebaseFirestoreTypes.WhereFilterOp;
    value: any;
};
interface SyncedRNFirebaseProps<TRemote extends object, TLocal, TAs extends CrudAsOption = 'value'> extends Omit<SyncedCrudPropsMany<TRemote, TLocal, TAs>, 'list' | 'retry'>, Omit<SyncedCrudPropsBase<TRemote, TLocal>, 'onError'> {
    collection: string;
    docId?: never;
    filters?: WhereFilter<TRemote>[];
    limit?: number;
    fieldTransforms?: FieldTransforms<TRemote>;
    onError?: (error: Error, params: RNFirebaseErrorParams) => void;
    realtime?: boolean;
    requireAuth?: boolean;
}
interface SyncedRNFirebasePropsWithDocId<TRemote extends object, TLocal, TAs extends CrudAsOption = 'value'> extends Omit<SyncedRNFirebaseProps<TRemote, TLocal, TAs>, 'docId'> {
    docId: string;
}
interface RNFirebaseErrorParams extends Omit<SyncedErrorParams, 'source'> {
    source: 'list' | 'get' | 'create' | 'update' | 'delete';
}
declare function syncedFirebase<TRemote extends object, TLocal = TRemote, TAs extends CrudAsOption = 'object'>(props: SyncedRNFirebaseProps<TRemote, TLocal, TAs>): SyncedCrudReturnType<TLocal, TAs>;
declare function syncedFirebase<TRemote extends object, TLocal = TRemote, TAs extends CrudAsOption = 'object'>(props: SyncedRNFirebasePropsWithDocId<TRemote, TLocal, TAs>): SyncedCrudReturnType<TLocal, TAs>;

export { type RNFirebaseErrorParams, type SyncedRNFirebaseProps, type SyncedRNFirebasePropsWithDocId, configureSyncedFirebase, syncedFirebase };
