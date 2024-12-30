Generally speaking, all TransAVormer streams are simply continuous,
beginning-to-end streams of their data. However, it is sometimes necessary to
change that behavior. For this purpose, TransAVormer supports *stream commands*,
which are commands that can be sent to alter the behavior of a stream.

Currently, the only stream command supported is `seek`.

To send stream commands, call the `sendCommands` method of your output stream
with an array of commands. Note that you should always call the final stream,
and not the stream most suited to receive the command; all streams will forward
commands backwards through the entire pipeline.

Stream commands have the following form:

```typescript
{
    c: string
}
```

The `c` field describes the command to be sent. Each command has additional
fields beyond this one, of course.

When an array of commands is sent, `sendCommands` returns an array of command
results, which have the following form:

```typescript
{
    ran: boolean,
    success: boolean,
    diagnostic: any[]
}
```

`ran` will be true if the command ran at all, i.e., if some element in the
pipeline was capable of interpreting and executing it. If `ran` is false, then,
perhaps counterintuitively, `success` is true—a command not being interpreted at
all is not considered a failure.

If the command was interpreted and executed but resulted in an error, then
`success` will be false. A diagnostic of some kind *may* be put in the
`diagnostic` array, but that is not guaranteed on failure.


# Seek

The only command currently implemented is `seek`. A seek command has the
following form:

```typescript
{
    c: "seek",
    time: number,
    min?: number,
    max?: number,
    stream?: number,
    streamTimebase?: boolean
}
```

The only mandatory field is `time`, the time to seek to, in seconds (by default,
but see `streamTimebase` below).

Seeking in most formats is inexact, both because data is discontinuous, and
because video data typically requires a keyframe. So, generally, you will seek
to *some time* before `time`, but exactly when depends on many circumstances.
You can set a floor on the time you seek to by additionally setting `min`.

Because the useful behavior of seeking is usually to get to some time *before*
`time`, `max` defaults to the same as `time`. If you set `max` to something
else, some formats are able to seek approximately and allow wiggle room in that
direction as well.

By default, seeking is supposed to choose which streams restrict its timing
wisely. You can instead override it to make these decisions based on a
particular stream, selected with `stream` by index.

All times default to seconds. If you set `streamTimebase` to true, they will
instead be interpreted in units of the timebase of the selected stream, or if no
stream is selected, in the default timebase of libav.js, microseconds.
