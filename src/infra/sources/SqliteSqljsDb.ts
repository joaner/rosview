import {
  type MessageReadOptions,
  type MessageRow,
  RawMessageIterator,
  parseQosProfiles,
  type RawMessage,
  type SqliteDb,
  type TopicDefinition,
} from '@foxglove/rosbag2';
import { fromNanoSec, toNanoSec, type Time } from '@foxglove/rostime';
import initSqlJs, { type Database, type SqlJsStatic, type Statement } from 'sql.js';

type DbContext = {
  db: Database;
  idToTopic: Map<bigint, TopicDefinition>;
  topicNameToId: Map<string, bigint>;
};

type TopicRowArray = [
  id: number,
  name: string,
  type: string,
  serialization_format: string,
  offered_qos_profiles?: string,
];

type MessageRowArray = [topic_id: number, timestamp: string, data: Uint8Array];

export class SqliteSqljsDb implements SqliteDb {
  #file?: Readonly<File>;
  #data?: Readonly<Uint8Array>;
  #context?: DbContext;

  static #sqlInitialization?: Promise<SqlJsStatic>;

  static async initialize(config?: Partial<EmscriptenModule>): Promise<SqlJsStatic> {
    if (SqliteSqljsDb.#sqlInitialization) {
      return await SqliteSqljsDb.#sqlInitialization;
    }

    SqliteSqljsDb.#sqlInitialization = initSqlJs(config);
    return await SqliteSqljsDb.#sqlInitialization;
  }

  constructor(data: File | Uint8Array) {
    if (data instanceof File) {
      this.#file = data;
    } else if (data instanceof Uint8Array) {
      this.#data = data;
    }
  }

  async open(): Promise<void> {
    const SQL = await SqliteSqljsDb.initialize();

    let db: Database;
    if (this.#file) {
      const buffer = await this.#file.arrayBuffer();
      db = new SQL.Database(new Uint8Array(buffer));
    } else if (this.#data) {
      db = new SQL.Database(this.#data);
    } else {
      db = new SQL.Database();
    }

    const idToTopic = new Map<bigint, TopicDefinition>();
    const topicNameToId = new Map<string, bigint>();
    const topicRows = (db.exec('select * from topics')[0]?.values ?? []) as TopicRowArray[];
    for (const row of topicRows) {
      const [id, name, type, serializationFormat, qosProfilesStr] = row;
      const offeredQosProfiles = parseQosProfiles(qosProfilesStr ?? '[]');
      const topic = { name, type, serializationFormat, offeredQosProfiles };
      const bigintId = BigInt(id);
      idToTopic.set(bigintId, topic);
      topicNameToId.set(name, bigintId);
    }

    this.#context = { db, idToTopic, topicNameToId };
  }

  close(): Promise<void> {
    if (this.#context != undefined) {
      this.#context.db.close();
      this.#context = undefined;
    }
    return Promise.resolve();
  }

  readTopics(): Promise<TopicDefinition[]> {
    if (this.#context == undefined) {
      throw new Error('Call open() before reading topics');
    }
    return Promise.resolve(Array.from(this.#context.idToTopic.values()));
  }

  readMessages(opts: MessageReadOptions = {}): AsyncIterableIterator<RawMessage> {
    if (this.#context == undefined) {
      throw new Error('Call open() before reading messages');
    }
    const db = this.#context.db;
    const topicNameToId = this.#context.topicNameToId;

    let args: (string | number)[] = [];
    let query = 'select topic_id,cast(timestamp as TEXT) as timestamp,data from messages';
    if (opts.startTime != undefined) {
      query += ' where timestamp >= cast(? as INTEGER)';
      args.push(toNanoSec(opts.startTime).toString());
    }
    if (opts.endTime != undefined) {
      if (args.length === 0) {
        query += ' where timestamp < cast(? as INTEGER)';
      } else {
        query += ' and timestamp < cast(? as INTEGER)';
      }
      args.push(toNanoSec(opts.endTime).toString());
    }
    if (opts.topics != undefined) {
      const topicIds: number[] = [];
      for (const topicName of opts.topics) {
        const topicId = topicNameToId.get(topicName);
        if (topicId != undefined) {
          topicIds.push(Number(topicId));
        }
      }

      if (topicIds.length === 0) {
        if (args.length === 0) {
          query += ' where topic_id = NULL';
        } else {
          query += ' and topic_id = NULL';
        }
      } else if (topicIds.length === 1) {
        if (args.length === 0) {
          query += ' where topic_id = ?';
        } else {
          query += ' and topic_id = ?';
        }
        args.push(topicIds[0]);
      } else {
        if (args.length === 0) {
          query += ` where topic_id in (${topicIds.map(() => '?').join(',')})`;
        } else {
          query += ` and topic_id in (${topicIds.map(() => '?').join(',')})`;
        }
        args = args.concat(topicIds);
      }
    }

    const statement = db.prepare(query, args);
    const dbIterator = new SqlJsMessageRowIterator(statement);
    return new RawMessageIterator(dbIterator, this.#context.idToTopic);
  }

  timeRange(): Promise<[min: Time, max: Time]> {
    if (this.#context == undefined) {
      throw new Error('Call open() before retrieving the time range');
    }
    const db = this.#context.db;

    const res = db.exec(
      'select cast(min(timestamp) as TEXT), cast(max(timestamp) as TEXT) from messages',
    )[0]?.values[0] ?? ['0', '0'];
    const [minNsec, maxNsec] = res as [string | null, string | null];
    return Promise.resolve([fromNanoSec(BigInt(minNsec ?? 0n)), fromNanoSec(BigInt(maxNsec ?? 0n))]);
  }

  messageCounts(): Promise<Map<string, number>> {
    if (this.#context == undefined) {
      throw new Error('Call open() before retrieving message counts');
    }
    const db = this.#context.db;

    const rows =
      db.exec(`
    select topics.name,count(*)
    from messages
    inner join topics on messages.topic_id = topics.id
    group by topics.id`)[0]?.values ?? ([] as [string, number][]);
    const counts = new Map<string, number>();
    for (const [topicName, count] of rows) {
      counts.set(topicName as string, count as number);
    }
    return Promise.resolve(counts);
  }

  topicTimeRanges(): Promise<Map<string, [min: Time, max: Time]>> {
    if (this.#context == undefined) {
      throw new Error('Call open() before retrieving topic time ranges');
    }
    const db = this.#context.db;

    const rows =
      db.exec(`
    select topics.name,cast(min(messages.timestamp) as TEXT),cast(max(messages.timestamp) as TEXT)
    from messages
    inner join topics on messages.topic_id = topics.id
    group by topics.id`)[0]?.values ?? [];
    const ranges = new Map<string, [min: Time, max: Time]>();
    for (const row of rows) {
      const [topicName, minNsec, maxNsec] = row as [string, string | null, string | null];
      ranges.set(topicName, [
        fromNanoSec(BigInt(minNsec ?? 0n)),
        fromNanoSec(BigInt(maxNsec ?? 0n)),
      ]);
    }
    return Promise.resolve(ranges);
  }
}

class SqlJsMessageRowIterator implements IterableIterator<MessageRow> {
  statement: Statement;

  constructor(statement: Statement) {
    this.statement = statement;
  }

  [Symbol.iterator](): IterableIterator<MessageRow> {
    return this;
  }

  next(): IteratorResult<MessageRow> {
    if (!this.statement.step()) {
      return { value: undefined, done: true };
    }

    const [topic_id, timestamp, data] = this.statement.get() as MessageRowArray;
    return {
      value: { topic_id: BigInt(topic_id), timestamp: BigInt(timestamp), data },
      done: false,
    };
  }

  return(): IteratorResult<MessageRow> {
    this.statement.freemem();
    this.statement.free();
    return { value: undefined, done: true };
  }
}
