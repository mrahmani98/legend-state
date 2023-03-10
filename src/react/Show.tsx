import type { Selector } from '@legendapp/state';
import { isObservableValueReady } from '@legendapp/state';
import { createElement, FC, ReactElement, ReactNode } from 'react';
import { useSelector } from './useSelector';

interface PropsIf<T> {
    if: Selector<T>;
    ifReady?: never;
}
interface PropsIfReady<T> {
    if?: never;
    ifReady: Selector<T>;
}

interface PropsBase<T> {
    else?: ReactNode | (() => ReactNode);
    wrap?: FC;
    children: ReactNode | ((value?: T) => ReactNode);
}

type Props<T> = PropsBase<T> & (PropsIf<T> | PropsIfReady<T>);

export function Show<T>(props: Props<T>): ReactElement;
export function Show<T>({ if: if_, ifReady, else: else_, wrap, children }: Props<T>): ReactElement {
    const value = useSelector<T>(if_ ?? ifReady);
    const child = useSelector(
        (ifReady !== undefined ? isObservableValueReady(value) : value) ? children : else_ ? else_ : null,
        {
            shouldRender: true,
        }
    ) as ReactElement;

    return wrap ? createElement(wrap, undefined, child) : child;
}
