const express = require('express');
const cors = require('cors');
const app = express()
const port = 5000
require('dotenv').config();

app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion } = require('mongodb');

app.get('/', (req, res) => {
  res.send('Hello World!')
})



const uri = process.env.MONGO_DB_URI

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const database = client.db("wisdomio_db");
    const lessonCollection = database.collection("lessons");

    // post a lesson
    app.post('/api/lessons', async (req, res) => {
        const lesson = req.body;
        const result = await lessonCollection.insertOne(lesson);
        res.send(result);
    })

    // get user specific lesson
    app.get("/api/lessons", async (req, res) => {
        const { userId } = req.query;
      
        const query = {};
      
        if (userId) {
          query.userId = userId;
        }
      
        const lessons = await lessonCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();
      
        res.send(lessons);
      });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})