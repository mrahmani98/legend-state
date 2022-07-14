import { extendPrototypes } from './PrimitivePrototypes';
import { ObsPersistLocal, ObsPersistRemote } from './ObsProxyInterfaces';

type ClassConstructor<I, Args extends any[] = any[]> = new (...args: Args) => I;

interface Config {
    extendPrototypes?: boolean;
    persist?: {
        localPersistence?: ClassConstructor<ObsPersistLocal>;
        remotePersistence?: ClassConstructor<ObsPersistRemote>;
        saveTimeout?: number;
        dateModifiedKey?: string;
    };
}

/** @internal **/
export const config: Config = { extendPrototypes: true };

export function configureObsProxy(options?: Config) {
    Object.assign(config, options);
    if (config.extendPrototypes) {
        extendPrototypes();
    }
}