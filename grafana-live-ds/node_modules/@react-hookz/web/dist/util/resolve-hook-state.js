function initState(initialState) {
    if (typeof initialState === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        initialState = initialState();
    }
    return initialState;
}
function updateState(nextState, previousState) {
    if (typeof nextState === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        return nextState(previousState);
    }
    return nextState;
}
export function resolveHookState(...args) {
    if (args.length === 1) {
        return initState(args[0]);
    }
    return updateState(args[0], args[1]);
}
