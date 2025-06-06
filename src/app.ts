import "dotenv/config";
import express, { Request, Response } from "express";
import {
  ButtonStyleTypes,
  InteractionResponseFlags,
  InteractionResponseType,
  InteractionType,
  MessageComponentTypes,
  verifyKeyMiddleware,
} from "discord-interactions";
import { getRandomEmoji, DiscordRequest } from "./utils.js";
import { getShuffledOptions, getResult } from "./game.js";

// Types
interface ActiveGame {
  id: string;
  objectName: string;
}

interface DiscordInteractionRequest extends Request {
  body: {
    id: string;
    type: number;
    data: {
      name?: string;
      custom_id?: string;
      values?: string[];
      options?: Array<{ value: string }>;
    };
    context?: number;
    member?: {
      user: {
        id: string;
      };
    };
    user?: {
      id: string;
    };
    token?: string;
    message?: {
      id: string;
    };
  };
}

// Create an express app
const app = express();
// Get port, or default to 3000
const PORT = process.env.PORT || 3000;
// To keep track of our active games
const activeGames: Record<string, ActiveGame> = {};

/**
 * Interactions endpoint URL where Discord will send HTTP requests
 * Parse request body and verifies incoming requests using discord-interactions package
 */
app.post(
  "/interactions",
  verifyKeyMiddleware(process.env.PUBLIC_KEY ?? ""),
  async function (req: DiscordInteractionRequest, res: Response): Promise<any> {
    // Interaction id, type and data
    const { id, type, data } = req.body;

    /**
     * Handle verification requests
     */
    if (type === InteractionType.PING) {
      return res.send({ type: InteractionResponseType.PONG });
    }

    /**
     * Handle slash command requests
     * See https://discord.com/developers/docs/interactions/application-commands#slash-commands
     */
    if (type === InteractionType.APPLICATION_COMMAND) {
      const { name } = data;
      // "test" command
      if (name === "test") {
        // Send a message into the channel where command was triggered from
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            // Fetches a random emoji to send from a helper function
            content: `hello world ${getRandomEmoji()}`,
          },
        });
      }

      // "challenge" command
      if (name === "challenge" && id) {
        // Interaction context
        const context = req.body.context;
        // User ID is in user field for (G)DMs, and member for servers
        const userId =
          context === 0 ? req.body.member?.user.id : req.body.user?.id;
        // User's object choice
        const objectName = req.body.data.options?.[0]?.value;

        if (!userId || !objectName) {
          return res.status(400).json({ error: "invalid request" });
        }

        // Create active game using message ID as the game ID
        activeGames[id] = {
          id: userId,
          objectName,
        };

        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `Rock papers scissors challenge from <@${userId}>`,
            components: [
              {
                type: MessageComponentTypes.ACTION_ROW,
                components: [
                  {
                    type: MessageComponentTypes.BUTTON,
                    // Append the game ID to use later on
                    custom_id: `accept_button_${req.body.id}`,
                    label: "Accept",
                    style: ButtonStyleTypes.PRIMARY,
                  },
                ],
              },
            ],
          },
        });
      }

      console.error(`unknown command: ${name}`);
      return res.status(400).json({ error: "unknown command" });
    }

    if (type === InteractionType.MESSAGE_COMPONENT) {
      // custom_id set in payload when sending message component
      const componentId = data.custom_id;

      if (componentId?.startsWith("accept_button_")) {
        // get the associated game ID
        const gameId = componentId.replace("accept_button_", "");
        // Delete message with token in request body
        const endpoint = `webhooks/${process.env.APP_ID}/${req.body.token}/messages/${req.body.message?.id}`;
        try {
          await res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: "What is your object of choice?",
              // Indicates it'll be an ephemeral message
              flags: InteractionResponseFlags.EPHEMERAL,
              components: [
                {
                  type: MessageComponentTypes.ACTION_ROW,
                  components: [
                    {
                      type: MessageComponentTypes.STRING_SELECT,
                      // Append game ID
                      custom_id: `select_choice_${gameId}`,
                      options: getShuffledOptions(),
                    },
                  ],
                },
              ],
            },
          });
          // Delete previous message
          await DiscordRequest(endpoint, { method: "DELETE" });
        } catch (err) {
          console.error("Error sending message:", err);
        }
      } else if (componentId?.startsWith("select_choice_")) {
        // get the associated game ID
        const gameId = componentId.replace("select_choice_", "");

        if (activeGames[gameId]) {
          // Interaction context
          const context = req.body.context;
          // Get user ID and object choice for responding user
          // User ID is in user field for (G)DMs, and member for servers
          const userId =
            context === 0 ? req.body.member?.user.id : req.body.user?.id;

          if (!userId) {
            return res.status(400).json({ error: "invalid user" });
          }

          // User's object choice
          const objectName = data.values?.[0];

          if (!objectName) {
            return res.status(400).json({ error: "invalid choice" });
          }

          // Calculate result from helper function
          const resultStr = getResult(activeGames[gameId], {
            id: userId,
            objectName,
          });

          // Remove game from storage
          delete activeGames[gameId];
          // Update message with token in request body
          const endpoint = `webhooks/${process.env.APP_ID}/${req.body.token}/messages/${req.body.message?.id}`;

          try {
            // Send results
            return res.send({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: { content: resultStr },
            });
            // Update ephemeral message
            await DiscordRequest(endpoint, {
              method: "PATCH",
              body: {
                content: "Nice choice " + getRandomEmoji(),
                components: [],
              },
            });
          } catch (err) {
            console.error("Error sending message:", err);
          }
        }
      }
      return;
    }

    console.error("unknown interaction type", type);
    return res.status(400).json({ error: "unknown interaction type" });
  }
);

app.listen(PORT, () => {
  console.log("Listening on port", PORT);
});
