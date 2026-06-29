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
    const reportedLessonCollection = database.collection("reportedLessons");
    const userCollection = database.collection("user");

    // post a reported lesson
    app.post("/api/reports", async (req, res) => {
      const {
        lessonId,
        reporterUserId,
        reason,
      } = req.body;

      const lesson =
        await lessonCollection.findOne({
          _id: new ObjectId(lessonId),
        });

      if (!lesson) {
        return res
          .status(404)
          .send({ message: "Lesson not found" });
      }

      const alreadyReported =
        await reportedLessonCollection.findOne({
          lessonId,
          reporterUserId,
        });

      if (alreadyReported) {
        return res.status(400).send({
          message:
            "You already reported this lesson.",
        });
      }

      await reportedLessonCollection.insertOne({
        lessonId,
        reportedUserId: lesson.userId,
        reporterUserId,
        reason,
        status: "pending",
        createdAt: new Date(),
      });

      await lessonCollection.updateOne(
        {
          _id: new ObjectId(lessonId),
        },
        {
          $inc: {
            reportCount: 1,
          },
        }
      );

      res.send({
        success: true,
      });
    });

    // post a lesson
    app.post('/api/lessons', async (req, res) => {
      const lesson = req.body;
      const result = await lessonCollection.insertOne(lesson);
      res.send(result);
    })

    // get users 
    app.get("/api/admin/users", async (req, res) => {
      try {
        const users = await userCollection
          .aggregate([
            {
              $lookup: {
                from: "lessons",
                localField: "id",
                foreignField: "userId",
                as: "lessons",
              },
            },
            {
              $project: {
                name: 1,
                email: 1,
                image: 1,
                role: 1,
                createdAt: 1,
                lessonCount: {
                  $size: "$lessons",
                },
              },
            },
          ])
          .toArray();

        res.send(users);
      } catch (err) {
        res.status(500).send(err);
      }
    });



    // get reported lessons

    app.get("/api/admin/reported-lessons", async (req, res) => {
      try {
        const reportedLessons = await reportedLessonCollection
          .aggregate([
            // Group all reports for each lesson
            {
              $group: {
                _id: "$lessonId",
                reportCount: { $sum: 1 },
                reports: {
                  $push: {
                    reporterUserId: "$reporterUserId",
                    reportedUserId: "$reportedUserId",
                    reason: "$reason",
                    createdAt: "$createdAt",
                  },
                },
              },
            },

            // Convert lessonId string to ObjectId
            {
              $addFields: {
                lessonObjectId: {
                  $toObjectId: "$_id",
                },
              },
            },

            // Get lesson
            {
              $lookup: {
                from: "lessons",
                localField: "lessonObjectId",
                foreignField: "_id",
                as: "lesson",
              },
            },

            {
              $unwind: "$lesson",
            },

            // Fetch reporter info for every report
            {
              $lookup: {
                from: "user",
                let: {
                  reports: "$reports",
                },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $in: [
                          "$_id",
                          {
                            $map: {
                              input: "$$reports",
                              as: "r",
                              in: {
                                $toObjectId: "$$r.reporterUserId",
                              },
                            },
                          },
                        ],
                      },
                    },
                  },
                  {
                    $project: {
                      name: 1,
                      email: 1,
                      image: 1,
                    },
                  },
                ],
                as: "reporters",
              },
            },

            // Attach reporter object to every report
            {
              $addFields: {
                reports: {
                  $map: {
                    input: "$reports",
                    as: "report",
                    in: {
                      reason: "$$report.reason",
                      createdAt: "$$report.createdAt",
                      reporter: {
                        $arrayElemAt: [
                          {
                            $filter: {
                              input: "$reporters",
                              as: "user",
                              cond: {
                                $eq: [
                                  "$$user._id",
                                  {
                                    $toObjectId:
                                      "$$report.reporterUserId",
                                  },
                                ],
                              },
                            },
                          },
                          0,
                        ],
                      },
                    },
                  },
                },
              },
            },

            {
              $project: {
                lessonId: "$_id",
                title: "$lesson.title",
                reportCount: 1,
                reports: 1,
              },
            },
          ])
          .toArray();

        res.send(reportedLessons);
      } catch (err) {
        console.error(err);
        res.status(500).send({
          success: false,
          message: "Failed to fetch reported lessons.",
        });
      }
    });

    // public lessons
    app.get("/api/lessons/public", async (req, res) => {
      const lessons = await lessonCollection
        .find({ visibility: "public" })
        .sort({ createdAt: -1 })
        .toArray();

      res.send(lessons);
    });

    // most saved lessons
    app.get("/api/lessons/most-saved", async (req, res) => {
      try {
        const lessons = await lessonCollection
          .find({ visibility: "public" })
          .sort({ savesCount: -1 })
          .limit(3)
          .toArray();

        res.send(lessons);
      } catch (err) {
        res.status(500).send(err);
      }
    });

    app.get("/api/contributors/top", async (req, res) => {
      try {
        const contributors = await lessonCollection.aggregate([
          {
            $match: {
              visibility: "public",
            },
          },
          {
            $group: {
              _id: "$userId",
              name: {
                $first: "$author",
              },
              image: {
                $first: "$authorImage",
              },
              lessonCount: {
                $sum: 1,
              },
            },
          },
          {
            $sort: {
              lessonCount: -1,
            },
          },
          {
            $limit: 4,
          },
        ]).toArray();

        res.send(contributors);
      } catch (err) {
        console.error(err);
        res.status(500).send({
          message: "Failed to fetch contributors",
        });
      }
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

    // ignore reports
    app.patch("/api/admin/reported-lessons/:lessonId/ignore", async (req, res) => {
      try {
        const { lessonId } = req.params;

        await reportedLessonCollection.deleteMany({
          lessonId,
        });

        res.send({
          success: true,
          message: "Reports cleared successfully.",
        });
      } catch (err) {
        console.error(err);

        res.status(500).send({
          success: false,
          message: "Failed to clear reports.",
        });
      }
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

    // delete a reported lesson
    app.delete("/api/admin/reported-lessons/:lessonId", async (req, res) => {
      try {
        const lessonId = req.params.lessonId;

        await lessonCollection.deleteOne({
          _id: new ObjectId(lessonId),
        });

        await reportedLessonCollection.deleteMany({
          lessonId,
        });

        res.send({
          success: true,
        });
      } catch (err) {
        res.status(500).send(err);
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






    // get featured lessons
    app.get("/api/featured-lessons", async (req, res) => {
      const lessons = await lessonCollection
        .find({
          featured: true,
          visibility: "public",
        })
        .sort({ createdAt: -1 })
        .limit(3)
        .toArray();

      res.send(lessons);
    });

    // admin stats
    app.get("/api/admin/stats", async (req, res) => {
      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const [
          totalUsers,
          publicLessons,
          reportedLessons,
          activeContributors,
          todaysLessons,
        ] = await Promise.all([
          userCollection.countDocuments(),

          lessonCollection.countDocuments({
            visibility: "public",
          }),

          reportedLessonCollection.countDocuments({
            status: "pending",
          }),

          lessonCollection
            .aggregate([
              {
                $group: {
                  _id: "$userId",
                },
              },
              {
                $count: "count",
              },
            ])
            .toArray()
            .then((result) => result[0]?.count || 0),

          lessonCollection.countDocuments({
            createdAt: {
              $gte: today.toISOString(),
            },
          }),
        ]);

        res.send({
          totalUsers,
          publicLessons,
          reportedLessons,
          activeContributors,
          todaysLessons,
        });
      } catch (err) {
        res.status(500).send({
          success: false,
          message: err.message,
        });
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

    // get favorite lessons for a user

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

    // feature a lesson
    app.patch("/api/lessons/feature/:id", async (req, res) => {
      try {
        const id = req.params.id;

        const lesson = await lessonCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!lesson) {
          return res.status(404).send({
            success: false,
            message: "Lesson not found",
          });
        }

        const result = await lessonCollection.updateOne(
          {
            _id: new ObjectId(id),
          },
          {
            $set: {
              featured: !lesson.featured,
            },
          }
        );

        res.send({
          success: result.modifiedCount > 0,
        });
      } catch (err) {
        res.status(500).send({
          success: false,
          message: err.message,
        });
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

    // change user role
    app.patch("/api/admin/users/:id", async (req, res) => {
      const id = req.params.id;

      await userCollection.updateOne(
        {
          _id: new ObjectId(id),
        },
        {
          $set: {
            role: "admin",
          },
        }
      );

      res.send({
        success: true,
      });
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