export enum ErrorType {
  BuildError = 1,
  Timeout = 2,
  ConnectionNotOpen = 3,
  Response = 4,
    InvalidWebsocket = 5,
    Unknown = -1,
}

export class RpcError extends Error {
  constructor(msg: string, public readonly code: ErrorType) {
    super(msg);
  }
}
