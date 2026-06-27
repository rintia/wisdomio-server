const express = require('express');
const cors = require('cors');
const app = express()
const port = 5000
require('dotenv').config();

app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

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
    const commentCollection = database.collection("comments");
    const favoriteCollection = database.collection("favorites");

    // post a lesson
    app.post('/api/lessons', async (req, res) => {
      const lesson = req.body;
      const result = await lessonCollection.insertOne(lesson);
      res.send(result);
    })

    // public lessons
    app.get("/api/lessons/public", async (req, res) => {
      const lessons = await lessonCollection
        .find({ visibility: "public" })
        .sort({ createdAt: -1 })
        .toArray();

      res.send(lessons);
    });

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

    // Get single lesson by ID
    app.get("/api/lessons/:id", async (req, res) => {
      try {
        const { id } = req.params;

        const lesson = await lessonCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!lesson) {
          return res.status(404).send({
            message: "Lesson not found",
          });
        }

        res.send(lesson);
      } catch (error) {
        console.error(error);
        res.status(500).send({
          message: "Failed to fetch lesson",
        });
      }
    });

    // update a lesson by ID
    app.patch("/api/lessons/:id", async (req, res) => {
      try {
        const { id } = req.params;

        const updatedData = req.body;

        const result = await lessonCollection.updateOne(
          {
            _id: new ObjectId(id),
          },
          {
            $set: {
              title: updatedData.title,
              description: updatedData.description,
              category: updatedData.category,
              tone: updatedData.tone,
              image: updatedData.image || "",
              accessLevel:
                updatedData.accessLevel || "free",
              updatedAt: new Date(),
            },
          }
        );

        res.send(result);
      } catch (error) {
        console.error(error);

        res.status(500).send({
          message: "Failed to update lesson",
        });
      }
    });

    // post a comment to a lesson
    app.post("/api/comments", async (req, res) => {
      try {
        const comment = req.body;

        comment.createdAt = new Date();

        const result = await commentCollection.insertOne(comment);

        await lessonCollection.updateOne(
          {
            _id: new ObjectId(comment.lessonId),
          },
          {
            $inc: {
              commentsCount: 1,
            },
          }
        );

        res.send(result);
      } catch (error) {
        res.status(500).send(error);
      }
    });

    // get comments for a lesson
    app.get("/api/comments", async (req, res) => {
      try {
        const { lessonId } = req.query;

        const comments = await commentCollection
          .find({
            lessonId,
          })
          .sort({
            createdAt: -1,
          })
          .toArray();

        res.send(comments);
      } catch (error) {
        res.status(500).send(error);
      }
    });

    // add like to a lesson
    app.patch("/api/lessons/:id/like", async (req, res) => {
      try {
        const { id } = req.params;
        const { userId } = req.body;

        const lesson = await lessonCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!lesson) {
          return res.status(404).send({
            message: "Lesson not found",
          });
        }

        const alreadyLiked = lesson.likes?.includes(userId);

        let result;

        if (alreadyLiked) {
          result = await lessonCollection.updateOne(
            { _id: new ObjectId(id) },
            {
              $pull: {
                likes: userId,
              },
              $inc: {
                likesCount: -1,
              },
            }
          );
        } else {
          result = await lessonCollection.updateOne(
            { _id: new ObjectId(id) },
            {
              $addToSet: {
                likes: userId,
              },
              $inc: {
                likesCount: 1,
              },
            }
          );
        }

        const updatedLesson = await lessonCollection.findOne({
          _id: new ObjectId(id),
        });

        res.send(updatedLesson);
      } catch (err) {
        res.status(500).send(err);
      }
    });


    // save a lesson to favorites

    app.patch("/api/lessons/:id/favorite", async (req, res) => {
      try {
        const { id } = req.params;

        const { userId } = req.body;

        const favorite = await favoriteCollection.findOne({
          lessonId: id,
          userId,  
        });

        if (favorite) {
          await favoriteCollection.deleteOne({
            _id: favorite._id,
          });

          await lessonCollection.updateOne(
            {
              _id: new ObjectId(id),
            },
            {
              $inc: {
                savesCount: -1,
              },
            }
          );

          return res.send({
            saved: false,
          });
        }

        await favoriteCollection.insertOne({
          lessonId: id,
          userId,
          createdAt: new Date(),
        });

        await lessonCollection.updateOne(
          {
            _id: new ObjectId(id),
          },
          {
            $inc: {
              savesCount: 1,
            },
          }
        );

        res.send({
          saved: true,
        });
      } catch (err) {
        res.status(500).send(err);
      }
    });

    // get favorite lessons
    app.get("/api/lessons/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { userId } = req.query;

        const lesson = await lessonCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!lesson) {
          return res.status(404).send({
            message: "Lesson not found",
          });
        }

        let isSaved = false;

        if (userId) {
          const favorite = await favoriteCollection.findOne({
            lessonId: id,
            userId,
          });

          isSaved = !!favorite;
        }

        res.send({
          ...lesson,
          isSaved,
        });
      } catch (err) {
        res.status(500).send(err);
      }
    });

    // get favorite lessons for a user
    const { ObjectId } = require("mongodb");

app.get("/api/favorites/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const favorites = await favoriteCollection
      .find({ userId })
      .sort({ createdAt: -1 })
      .toArray();

    const lessonIds = favorites.map(
      (f) => new ObjectId(f.lessonId)
    );

    const lessons = await lessonCollection
      .find({
        _id: {
          $in: lessonIds,
        },
      })
      .toArray();

    const data = favorites.map((favorite) => ({
      ...favorite,
      lesson: lessons.find(
        (l) => l._id.toString() === favorite.lessonId
      ),
    }));

    res.send(data);
  } catch (err) {
    res.status(500).send(err);
  }
});

// remove a lesson from favorites
app.delete(
  "/api/favorites/:lessonId/:userId",
  async (req, res) => {
    try {
      const { lessonId, userId } = req.params;

      await favoriteCollection.deleteOne({
        lessonId,
        userId,
      });

      await lessonCollection.updateOne(
        {
          _id: new ObjectId(lessonId),
        },
        {
          $inc: {
            savesCount: -1,
          },
        }
      );

      res.send({
        deleted: true,
      });
    } catch (err) {
      res.status(500).send(err);
    }
  }
);

// update lesson visibility
app.patch("/api/lessons/:id/visibility", async (req, res) => {
  try {
    const { id } = req.params;
    const { visibility } = req.body;

    const result = await lessonCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          visibility,
          updatedAt: new Date().toISOString(),
        },
      }
    );

    res.send(result);
  } catch (err) {
    res.status(500).send(err);
  }
});

    // delete a lesson by ID
    app.delete("/api/lessons/:id", async (req, res) => {
      try {
        const { id } = req.params;

        const result =
          await lessonCollection.deleteOne({
            _id: new ObjectId(id),
          });

        res.send(result);
      } catch (error) {
        console.error(error);

        res.status(500).send({
          message: "Failed to delete lesson",
        });
      }
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