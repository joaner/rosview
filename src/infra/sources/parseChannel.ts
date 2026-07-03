import type { MessageDefinition, MessageDefinitionField } from "@foxglove/message-definition";
import type { IDLMessageDefinition } from "@foxglove/omgidl-parser";
import { parseIDL } from "@foxglove/omgidl-parser";
import { MessageReader as OmgidlMessageReader } from "@foxglove/omgidl-serialization";
import { parseRos2idl } from "@foxglove/ros2idl-parser";
import { parse as parseMessageDefinition } from "@foxglove/rosmsg";
import { MessageReader } from "@foxglove/rosmsg-serialization";
import { MessageReader as ROS2MessageReader } from "@foxglove/rosmsg2-serialization";
import { toObject as flexbuffersToObject } from "flatbuffers/js/flexbuffers.js";
import protobuf from "protobufjs";
import "protobufjs/ext/descriptor";
import type { MessageDefinitionMap } from "./types";

/** `protobufjs/ext/descriptor` augments Root at runtime; types omit the extension. */
type ProtobufWithDescriptor = typeof protobuf & {
  descriptor: { FileDescriptorSet: { decode(data: Uint8Array): unknown } };
};
const pb = protobuf as ProtobufWithDescriptor;
const RootWithDescriptor = protobuf.Root as typeof protobuf.Root & {
  fromDescriptor(descriptor: unknown): protobuf.Root;
};

type Channel = {
  messageEncoding: string;
  schema: { name: string; encoding: string; data: Uint8Array } | undefined;
};

export type ParsedChannel = {
  deserialize: (data: ArrayBufferView) => unknown;
  datatypes: MessageDefinitionMap;
};

const KNOWN_EMPTY_SCHEMA_NAMES = ["std_msgs/Empty", "std_msgs/msg/Empty"];

function parseIDLDefinitionsToDatatypes(
  parsedDefinitions: IDLMessageDefinition[],
  rootName?: string,
) {
  const convertUnionToMessageDefinition = (definition: IDLMessageDefinition): MessageDefinition => {
    if (definition.aggregatedKind === "union") {
      const innerDefs: MessageDefinitionField[] = definition.cases.map((caseDefinition) => ({
        ...caseDefinition.type,
        predicates: caseDefinition.predicates,
      }));

      if (definition.defaultCase != undefined) {
        innerDefs.push(definition.defaultCase);
      }
      const { name } = definition;
      return {
        name,
        definitions: innerDefs,
      };
    }
    return definition;
  };

  const standardDefs: MessageDefinition[] = parsedDefinitions.map(convertUnionToMessageDefinition);
  return parsedDefinitionsToDatatypes(standardDefs, rootName);
}

function parsedDefinitionsToDatatypes(
  parsedDefinitions: MessageDefinition[],
  rootName?: string,
): MessageDefinitionMap {
  const datatypes: MessageDefinitionMap = new Map();
  parsedDefinitions.forEach(({ name, definitions }, index) => {
    if (rootName != undefined && index === 0) {
      datatypes.set(rootName, { name: rootName, definitions });
    } else if (name != undefined) {
      datatypes.set(name, { name, definitions });
    }
  });
  return datatypes;
}

export function parseChannel(
  channel: Channel,
  options?: { allowEmptySchema: boolean },
): ParsedChannel {
  if (
    options?.allowEmptySchema !== true &&
    ["ros1msg", "ros2msg", "ros2idl"].includes(channel.schema?.encoding ?? "") &&
    channel.schema?.data.length === 0 &&
    !KNOWN_EMPTY_SCHEMA_NAMES.includes(channel.schema?.name ?? "")
  ) {
    throw new Error(`Schema for ${channel.schema?.name} is empty`);
  }

  if (channel.messageEncoding === "json") {
    const textDecoder = new TextDecoder();
    const datatypes: MessageDefinitionMap = new Map();
    const deserialize = (data: ArrayBufferView): unknown => JSON.parse(textDecoder.decode(data));
    return { deserialize, datatypes };
  }

  if (channel.messageEncoding === "ros1") {
    if (!channel.schema || channel.schema.encoding !== "ros1msg") {
      throw new Error(`Expected ros1msg schema for ros1 encoding`);
    }
    const schema = new TextDecoder().decode(channel.schema.data);
    const parsedDefinitions = parseMessageDefinition(schema);
    const reader = new MessageReader(parsedDefinitions);
    return {
      datatypes: parsedDefinitionsToDatatypes(parsedDefinitions, channel.schema.name),
      deserialize: (data) => reader.readMessage(data),
    };
  }

  if (channel.messageEncoding === "cdr") {
    if (
      !channel.schema ||
      (channel.schema.encoding !== "ros2msg" &&
        channel.schema.encoding !== "ros2idl" &&
        channel.schema.encoding !== "omgidl")
    ) {
      throw new Error(`Expected ros2msg, ros2idl or omgidl schema for cdr encoding`);
    }
    const schema = new TextDecoder().decode(channel.schema.data);
    if (channel.schema.encoding === "omgidl") {
      const parsedDefinitions = parseIDL(schema);
      const reader = new OmgidlMessageReader(channel.schema.name, parsedDefinitions);
      const datatypes = parseIDLDefinitionsToDatatypes(parsedDefinitions);
      return {
        datatypes,
        deserialize: (data) => reader.readMessage(data),
      };
    } else {
      const isIdl = channel.schema.encoding === "ros2idl";
      const parsedDefinitions = isIdl
        ? parseRos2idl(schema)
        : parseMessageDefinition(schema, { ros2: true });
      const reader = new ROS2MessageReader(parsedDefinitions, { timeType: "sec,nsec" });
      return {
        datatypes: parsedDefinitionsToDatatypes(parsedDefinitions, channel.schema.name),
        deserialize: (data) => reader.readMessage(data),
      };
    }
  }

  const msgEnc = channel.messageEncoding.toLowerCase();
  if (msgEnc === "protobuf" || msgEnc === "proto") {
    if (!channel.schema) {
      throw new Error(`protobuf encoding requires a schema (FileDescriptorSet)`);
    }
    if (channel.schema.encoding !== "protobuf" && channel.schema.encoding !== "proto") {
      throw new Error(`Expected protobuf schema encoding for protobuf channel, got ${channel.schema.encoding}`);
    }
    const fds = pb.descriptor.FileDescriptorSet.decode(channel.schema.data);
    const root = RootWithDescriptor.fromDescriptor(fds);
    const typeName = channel.schema.name.replace(/^\./, "");
    const resolvedType = root.lookupTypeOrEnum(typeName);
    if (!resolvedType || !(resolvedType instanceof protobuf.Type)) {
      throw new Error(`Could not resolve protobuf message type "${typeName}" from descriptor set`);
    }
    const messageType = resolvedType;
    const datatypes: MessageDefinitionMap = new Map();
    return {
      datatypes,
      deserialize: (data) =>
        messageType.toObject(messageType.decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)), {
          longs: String,
          enums: String,
          bytes: Uint8Array,
          defaults: true,
        }),
    };
  }

  if (msgEnc === "flatbuffer" || msgEnc === "flatbuffers") {
    const schema = channel.schema;
    if (schema && schema.data.length > 0) {
      const probe = new TextDecoder().decode(schema.data.subarray(0, Math.min(256, schema.data.length)));
      if (/\b(table|struct|namespace)\b/i.test(probe)) {
        throw new Error(
          "FlatBuffer schema appears to be .fbs text; runtime table decoding is not bundled. Use FlexBuffers payloads or a JSON/protobuf channel.",
        );
      }
    }
    const datatypes: MessageDefinitionMap = new Map();
    return {
      datatypes,
      deserialize: (data) => {
        try {
          const u8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
          const copy = u8.slice().buffer;
          return flexbuffersToObject(copy);
        } catch (err) {
          return {
            _rosviewFlatbufferDecodeFailed: true,
            message: err instanceof Error ? err.message : String(err),
            byteLength: data.byteLength,
          };
        }
      },
    };
  }

  throw new Error(`Unsupported encoding ${channel.messageEncoding}`);
}
