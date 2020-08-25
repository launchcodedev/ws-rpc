import {
  serialize as serializeBSON,
  deserialize as deserializeBSON,
  DeserializeOptions,
} from 'bson';
import {
  Client as BaseClient,
  Server as BaseServer,
  Serializable,
  Deserializable,
  MessageType,
  EventType,
  MessageVariants,
  EventVariants,
} from './index';

export {
  Serializable,
  Deserializable,
  MessageType,
  EventType,
  MessageVariant,
  EventVariant,
  MessageVariants,
  EventVariants,
} from './index';

function serialize(data: Serializable): Deserializable {
  return serializeBSON(data);
}

async function deserialize<Out extends Serializable>(
  data: Deserializable,
  deserializeOptions: DeserializeOptions,
): Promise<Out> {
  if (typeof data === 'string') {
    // we won't complain, just assume someone sent JSON
    return JSON.parse(data) as Out;
  }

  let buffer: Buffer | Uint8Array;

  if ('arrayBuffer' in data) {
    buffer = new Uint8Array(await data.arrayBuffer());
  } else if (data instanceof ArrayBuffer) {
    buffer = new Uint8Array(data);
  } else {
    buffer = data;
  }

  return deserializeBSON(buffer as Buffer, { promoteBuffers: true, ...deserializeOptions }) as Out;
}

export class Client<
  MessageTypes extends MessageType,
  EventTypes extends EventType,
  H extends MessageVariants<MessageTypes>,
  E extends EventVariants<EventTypes>
> extends BaseClient<MessageTypes, EventTypes, H, E> {
  private deserializeOptions: DeserializeOptions = {};

  setDeserializeOptions(options: DeserializeOptions) {
    this.deserializeOptions = options;
  }

  async serialize(data: Serializable): Promise<Deserializable> {
    return serialize(data);
  }

  async deserialize<Out extends Serializable>(data: Deserializable): Promise<Out> {
    return deserialize<Out>(data, this.deserializeOptions);
  }
}

export class Server<
  MessageTypes extends MessageType,
  EventTypes extends EventType,
  H extends MessageVariants<MessageTypes>,
  E extends EventVariants<EventTypes>
> extends BaseServer<MessageTypes, EventTypes, H, E> {
  private deserializeOptions: DeserializeOptions = {};

  setDeserializeOptions(options: DeserializeOptions) {
    this.deserializeOptions = options;
  }

  async serialize(data: Serializable): Promise<Deserializable> {
    return serialize(data);
  }

  async deserialize<Out extends Serializable>(data: Deserializable): Promise<Out> {
    return deserialize<Out>(data, this.deserializeOptions);
  }
}
