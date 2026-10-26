# One request

The request fields, answers and failure reasons of `sagents ask` are here.
The [connections](connection.md) say how a request is sent; [README](../README.md#what-works-today) says how to start.

`sagents ask [--timeout <seconds>]` reads one request as JSON from stdin, at most 16,000,000 bytes, with a nonempty list of messages,
and prints one JSON line. `--timeout <seconds>` limits the call, the reading
of the request included, and is 180 by default; it accepts a finite number from 1 to 3600. It does not cut short a renewal of the ChatGPT plan's access token,
which a call begins with when the token is about to expire: the renewal runs to its own end, at most 90 seconds of
waiting for another sagents process that is renewing and then 30 seconds for the sign-in service, so that a new pair
of tokens is never lost unsaved, and a call whose limit passed meanwhile ends with `timeout` right after it.

| Field | Meaning |
| --- | --- |
| `model` | `api:<id>`, a model of [your own server](connection.md#a-server-of-your-own); or a model id of the ChatGPT plan, alone or as `<id>@<effort>` with `minimal`, `low`, `medium`, `high`, `xhigh` or `max`. |
| `messages` | `user` and `assistant` messages with text `content`. |
| `system` | Optional instructions. |
| `schema` | Optional JSON Schema, in OpenAI's strict form, that the answer must follow. |
| `cache` | Optional name of your own for whoever the request is one of, 64 characters at most of letters, digits, `-` and `_`, so that a service that keeps the beginnings of requests it has read brings the requests under one name to the same place. It holds nothing of the text. See each connection for how it is sent; a request with none is sent with none. |

```json
{"status":"done","text":"Hi.","usage":{"inputTokens":0,"cachedInputTokens":0,"writtenInputTokens":null,"outputTokens":0,"reasoningTokens":0}}
{"status":"failed","reason":"invalid_request","httpStatus":400,"providerCode":"subscription_sharing_unsupported_capability","param":"reasoning.effort"}
```

The numbers and the failure above only show the shape. `usage` gives input, cached input, written input, output
and reasoning tokens, null for a count the service did not report. On a server, `writtenInputTokens` comes from
`usage.prompt_tokens_details.cache_write_tokens`; cached and written tokens are already inside `inputTokens`.
The ChatGPT plan reports no written count.

An answer is whole or it is a failure: one that the model's own
limit cut short comes back as `output_limit`, without the text written by then. This holds for what a call returns,
and `ask` and `live` take nothing else. A program that calls `src/chatgpt.ts` itself and gives it `onText` is handed
the text as the stream brings it, before the answer is known to be whole or to come from the model asked for, so a
call that ends in a failure, `wrong_model` included, may have handed over a part by then. The same holds for
`src/compatible.ts` with `SAGENTS_API_STREAM`; without it an `api:` server's text is handed over once, whole and checked.
Given `onSpent`, either connection calls it with the `budget_exceeded` failure as soon as it reads that the plan's limit
or the key's balance is used up, before the call itself ends, so that a program with other calls under way can stop
them before they send anything more; `evolve` does so. It is not waited for, so what stops the other calls has to
happen in it at once; a promise it returns is let go, and its failure with it.
`createChatgpt` in `src/chatgpt.ts` sends once more after two seconds only when the connection rejects before a response,
within the same time limit and unless cancelled or timed out; a failure after any response is never sent again.

| `reason` | What happened |
| --- | --- |
| `unauthorized` | Not signed in, the session is over, or OpenAI refuses this account or registration. Run `login`. For `api:`, the server refused the key or asks for one (HTTP 401 or 403). |
| `budget_exceeded` | The plan's limit, or the share of it given to sagents, is used up. For `api:`, the balance behind the key is (HTTP 402). |
| `rate_limited`, `model_unavailable`, `provider_failed` | The service did not serve the request this time. `provider_failed` without `httpStatus` means it could not be reached. |
| `invalid_request`, `context_limit` | The request cannot be served as it is. `param` names the field when the service did, and for `api:` the setting or the field that sagents itself refused, before anything was sent. |
| `output_limit`, `incomplete_stream`, `invalid_stream`, `invalid_response`, `empty_response` | The answer did not arrive whole or cannot be read. |
| `declined` | The service declined to write an answer. On the plan's stream that is an event of a refusal (`response.refusal.delta`, `response.refusal.done`), an answer left incomplete by the `content_filter`, or a part of type `refusal` in the closing event; from an `api:` server, a `finish_reason` of `content_filter` or a message with a `refusal`. Nothing of what the service wrote is kept. These shapes are taken from what the two APIs document: no refusal of a real service was seen, so a service that declines in another shape is reported under another code, `empty_response` or `incomplete_stream` most likely. |
| `wrong_model` | The plan's service said that another model answers than the one asked for. Nothing of that answer is returned. Checked only for the ChatGPT plan, and only when the stream names a model: a stream that names none is taken as it is, and an `api:` server's answer is not checked. |
| `unexpected_tools` | The answer held a call of a tool, and sagents offers none. Nothing of that answer is returned. |
| `timeout`, `cancelled` | The call's own limit, or its caller, stopped it. |
| `storage_failed` | The account file or its lock could not be read or written. An account file that cannot be read or understood is left as it is; repair or remove it by hand in `~/.config/sagents/`. |
| `internal_error` | sagents itself failed in a way that has no code of its own. |

The [connection checks](measured.md#connections-used) cover only the accounts and servers used there.
