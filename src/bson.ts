import { serialize as serializeBSON, deserialize as deserializeBSON } from 'bson';
import { DataSerialization } from './index';

/* eslint-disable @typescript-eslint/no-unsafe-return */
const serialization: DataSerialization<any> = {
  serialize(data) {
    return serializeBSON(data);
  },

  async deserialize(data: string | ArrayBuffer | Blob) {
    if (typeof data === 'string') {
      // we won't complain, just assume someone sent JSON
      return JSON.parse(data);
    }

    let buffer: Buffer | Uint8Array;

    if ('arrayBuffer' in data) {
      buffer = new Uint8Array(await data.arrayBuffer());
    } else if (data instanceof ArrayBuffer) {
      buffer = new Uint8Array(data);
    } else {
      buffer = data;
    }

    return deserializeBSON(buffer as Buffer, { promoteBuffers: true });
  },
};

export default serialization;
