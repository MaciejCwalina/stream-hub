type StateInitializerFN<State> = () => State;
type StateUpdaterFN<State, PreviousState = State> = (previousState: PreviousState) => State;
export type InitialState<State> = State | StateInitializerFN<State>;
export type NextState<State, PreviousState = State> = State | StateUpdaterFN<State, PreviousState>;
declare function initState<State>(initialState: InitialState<State>): State;
declare function updateState<State, PreviousState = State>(nextState: NextState<State, PreviousState>, previousState: PreviousState): State;
export declare function resolveHookState<State, PreviousState = State>(...args: Parameters<typeof initState<State>> | Parameters<typeof updateState<State, PreviousState>>): State;
export {};
