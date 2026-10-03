// Stores the Baileys login in MongoDB instead of the wa-auth folder,
// so it survives restarts on hosts with temporary disks.
async function useMongoAuthState(collection, baileys) {
  const { BufferJSON, initAuthCreds, proto } = baileys;

  const write = (id, data) =>
    collection.replaceOne(
      { _id: id },
      { _id: id, value: JSON.stringify(data, BufferJSON.replacer) },
      { upsert: true }
    );

  const read = async (id) => {
    const doc = await collection.findOne({ _id: id });
    return doc ? JSON.parse(doc.value, BufferJSON.reviver) : null;
  };

  const remove = (id) => collection.deleteOne({ _id: id });

  const creds = (await read('creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await read(`${type}-${id}`);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              tasks.push(value ? write(key, value) : remove(key));
            }
          }
          await Promise.all(tasks);
        }
      }
    },
    saveCreds: () => write('creds', creds)
  };
}

module.exports = { useMongoAuthState };