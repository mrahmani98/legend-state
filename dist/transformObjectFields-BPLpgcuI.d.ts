declare function transformObjectFields(dataIn: Record<string, any>, map: Record<string, any>): any;
declare function invertFieldMap(obj: Record<string, any>): any;

export { invertFieldMap as i, transformObjectFields as t };
