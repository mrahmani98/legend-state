import { FCReactiveObject } from '@legendapp/state/react';

type IReactive = FCReactiveObject<JSX.IntrinsicElements>;
declare const $React: IReactive;

export { $React };
