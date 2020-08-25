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

function serialize(data: Serializable): Deserializable {
  return serializeBSON(data);
}

function deserialize<Out extends Serializable>(
  data: Deserializable,
  deserializeOptions: DeserializeOptions,
): Out {
  if (typeof data === 'string') {
    // we won't complain, just assume someone sent JSON
    return JSON.parse(data) as Out;
  }

  return deserializeBSON(data as Buffer, { promoteBuffers: true, ...deserializeOptions }) as Out;
}

export class BSONClient<
  MessageTypes extends MessageType,
  EventTypes extends EventType,
  H extends MessageVariants<MessageTypes>,
  E extends EventVariants<EventTypes>
> extends BaseClient<MessageTypes, EventTypes, H, E> {
  private deserializeOptions: DeserializeOptions = {};

  setDeserializeOptions(options: DeserializeOptions) {
    this.deserializeOptions = options;
  }

  serialize(data: Serializable): Deserializable {
    return serialize(data);
  }

  deserialize<Out extends Serializable>(data: Deserializable): Out {
    return deserialize<Out>(data, this.deserializeOptions);
  }
}

export class BSONServer<
  MessageTypes extends MessageType,
  EventTypes extends EventType,
  H extends MessageVariants<MessageTypes>,
  E extends EventVariants<EventTypes>
> extends BaseServer<MessageTypes, EventTypes, H, E> {
  private deserializeOptions: DeserializeOptions = {};

  setDeserializeOptions(options: DeserializeOptions) {
    this.deserializeOptions = options;
  }

  serialize(data: Serializable): Deserializable {
    return serialize(data);
  }

  deserialize<Out extends Serializable>(data: Deserializable): Out {
    return deserialize<Out>(data, this.deserializeOptions);
  }
}
