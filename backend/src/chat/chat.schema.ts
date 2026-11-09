import * as yup from 'yup';

// POST /api/chat body. The browser keeps the conversation and sends it with every message (the
// server stores nothing); only the latest MAX_TURNS are used, and each message is capped.
export const MAX_TURNS = 30;
export const MAX_USER_CHARS = 1000;
const MAX_ASSISTANT_CHARS = 2000;

export const chatSchema = yup.object({
  messages: yup
    .array(
      yup.object({
        role: yup.string().required().oneOf(['user', 'assistant'] as const),
        text: yup
          .string()
          .trim()
          .required('Please type a message.')
          .when('role', {
            is: 'user',
            then: (s) => s.max(MAX_USER_CHARS, `Messages can be up to ${MAX_USER_CHARS} characters.`),
            otherwise: (s) => s.max(MAX_ASSISTANT_CHARS),
          }),
      }),
    )
    .required('Please type a message.')
    .min(1, 'Please type a message.')
    .max(200, 'This chat is too long. Please refresh the page to start a new one.')
    .test('ends-with-user', 'Please type a message.', (list) => list?.[list.length - 1]?.role === 'user'),
});

export type ChatInput = yup.InferType<typeof chatSchema>;
