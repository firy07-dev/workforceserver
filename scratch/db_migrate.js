const { MongoClient } = require('mongodb');

// Source and Destination URLs
const SOURCE_URL = "mongodb+srv://lms_user:LKQMKoZWnnYRb4IU@cluster0.ffzv4sh.mongodb.net/lms_db";
const DEST_URL = "mongodb+srv://firy07_db_user:9qIYAeNL2zlPnkMm@cluster0.2jgld7l.mongodb.net/lms_db";

async function migrate() {
  const sourceClient = new MongoClient(SOURCE_URL);
  const destClient = new MongoClient(DEST_URL);

  try {
    console.log('Connecting to databases...');
    await sourceClient.connect();
    await destClient.connect();
    console.log('Connected to both SOURCE and DESTINATION databases.');

    const sourceDb = sourceClient.db();
    const destDb = destClient.db();

    // Get all collections from source
    const collections = await sourceDb.listCollections().toArray();
    console.log(`Found ${collections.length} collections in source.`);

    for (const colInfo of collections) {
      const colName = colInfo.name;
      
      // Skip system collections if any
      if (colName.startsWith('system.')) continue;

      console.log(`\nProcessing collection: ${colName}...`);
      
      const sourceCol = sourceDb.collection(colName);
      const destCol = destDb.collection(colName);

      const data = await sourceCol.find({}).toArray();
      console.log(`Found ${data.length} records in source collection "${colName}".`);

      if (data.length > 0) {
        // Clear destination collection first
        await destCol.deleteMany({});
        console.log(`Cleared destination collection "${colName}".`);

        // Insert data
        const result = await destCol.insertMany(data);
        console.log(`Successfully migrated ${result.insertedCount} records to destination.`);
      } else {
        console.log(`Skipping empty collection "${colName}".`);
      }
    }

    console.log('\nMigration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await sourceClient.close();
    await destClient.close();
  }
}

migrate();
