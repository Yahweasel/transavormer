TransAVormer has only one entry function, `build`. `build` takes a descriptor
(called an “initializer”) of what kind of transformation you wish to perform.
Every initializer has a `type` field and an `input` field, and some have other
fields, which will vary based on the transformer being built. TransAVormer is a
frontend to libav.js and WebCodecs, so in addition, it requires a
[libav.js](https://github.com/Yahweasel/libav.js) instance. For instance, to
build a muxer,

```javascript
const libav = await LibAV.LibAV();
const out = await TransAVormer.build(libav, {
    type: "muxer",
    input: inputFile
});
const rdr = out.stream.getReader();
while (true) {
    const rd = await rdr.read();
    if (rd.done) break;
    // Do something with rd.value
}
libav.terminate();
```

While TransAVormer has only one entry function, it has a plethora of types. All
TransAVormer types are (or encapsulate) `ReadableStream`s, and they can be
distinguished by what kind of thing the `ReadableStream`s are streaming. This
document describes all the transformers and types, taking a type-first approach.

This document extensively uses digital multimedia jargon. It is not possible to
create a library performing this task that does not require a reasonable
understanding of such digital media concepts as multiplexing and codecs. The
terminology used here is the terminology used by FFmpeg, and may not exactly
match the terminology used by other systems; the term “packet” is used for
*encoded* chunks of data, and “frame” is used for *unencoded* chunks of data
(both video and audio). A “crash course” in digital media is provided in
[AV-CRASH-COURSE.md](AV-CRASH-COURSE.md).

Frame and packet times in TransAVormer can either be in libav.js format or
WebCodecs formats. In libav.js (as in FFmpeg/libav), timestamps carry their
timebase with them, as `time_base_num` and `time_base_den`, so to convert a
timestamp to seconds, you multiply by `time_base_num` (the numerator) and divide
by `time_base_den` (the denominator). WebCodecs timestamps are always in
microseconds.

The various types can all be used as `input` fields to `build` initializers.
TransAVormer will find the necessary transformations to make the input type
match the expected data. So, for instance, to transmux, you don't need to
explicitly specify a demuxing stage, only a muxing state. TransAVormer will
discover that a demuxing stage is necessary based on inputting a file. Or,
`input` can be an initialier for another stage, so, for instance, to transcode,
provide an encoder stage as input to a muxer stage, but you can still provide an
input file directly to the encoder stage; TransAVormer will discover that it
needs to demux and decode before encoding makes sense.


# Stream wrappers

With the exception of input files, all TransAVormer types include a wrapper
object that, at least, describes what type they're streaming. For example, if
you create a muxer stream, the returned object has this form:

```typescript
{
    component: "muxer",
    streamType: "file",
    stream: ReadableStream<{position: number, data: Uint8Array}>,
    sendCommands: (cmds: Command[]) => Promise<CommandResult[]>
}
```

The `streamType` field tells you that what is being streamed is a file. Of
course, you will also have known this because you requested a muxer, which will
always stream a file. Additionally, the `component` field tells you exactly what
kind of file stream this is. That's generally only useful for diagnostics, since
you presumably know what it is (you asked for it!). The `sendCommands` method is
for stream commands, documented in [STREAM-COMMANDS.md](STREAM-COMMANDS.md).


# Input files

Quite often, your input will be a multiplexed file, or some equivalent, such as
a stream. In FFmpeg terms, a file format and a protocol are the same, so these
are both considered input “files”.

TransAVormer supports four ways of feeding in input files: two streaming, and
two random-access. In any case, input files are *not* wrapped in stream wrappers
(as they're expected to come from the user, not from TransAVormer).

In all four cases, TransAVormer expects `Uint8Array`s. Please make sure your
data is wrapped in a `Uint8Array`; sending naked `ArrayBuffer`s won't work.

## Streaming input files

If your input is in the form of a stream (i.e., it is to be read from the
beginning to the end, with no seeking), you can provide it in one of two forms.
The simplest option is to provide a `ReadableStream<Uint8Array>`. Alternatively,
you can provide an object with a `read` field, like so:

```typescript
{
    read: (len: number) => Promise<Uint8Array | null>
}
```

TransAVormer (really, libav.js) will call `read` every time it needs to read
more data. Return `null` to indicate EOF. The amount you return does not have to
match the length.

## Random-access input files

Some formats cannot be read in a streaming fashion. You can provide a
random-access input file as a `Blob` (or a `File`, which is a subtype of
`Blob`), or as an object with both a `size` field and a `read` field:

```typescript
{
    size: number,
    read: (pos: number, len: number) => Promise<Uint8Array | null>
}
```

The `size` field, which indicates the size of the file being read in bytes, is
mandatory, not just to distinguish it from streaming input files, but so that
the underlying reader knows where it can read from. As with streaming input
files, return `null` to indicate EOF, and you don't have to return the length
requested. `pos` is the position in the file being read from, in bytes.


# Packet streams

Packet streams have the following form:

```typescript
{
    streamType: "packet",
    streams: Promise<StreamParameters[]>,
    stream: ReadableStream<Packet[]>,
    sendCommands: (cmds: Command[]) => Promise<CommandResult[]>
}
```

where `Packet` is libav.js's packet type. `StreamParameters` is `CodecParameters
& {time_base_num: number, time_base_den: number}`, i.e., libav.js codec
parameters with mandatory timebase. The packets can come from any number of
streams. The `streams` array gives information on each stream; most generically,
the streams describe at least a `codec_type`, which is either
`libav.AVMEDIA_TYPE_VIDEO` or `libav.AVMEDIA_TYPE_AUDIO`. The packet arrays
coming in as chunks from `stream` are in input order, and don't necessarily have
any correspondence to the `streams` array; use `packet.stream_index` to figure
out which stream any packet belongs to.

There are four initializers capable of creating packet streams: demuxer,
encoder, packet selector, and user packet stream.

## Demuxer

Create a demuxer with a `"demuxer"` initializer:

```javascript
const out = await TransAVormer.build(libav, {
    type: "demuxer",
    chunkSize: 65536,
    input: inputFile
});
```

The `chunkSize` field is optional, and defaults to `65536`. It is the size (in
bytes) of chunks that will be sent (as arrays of packets) through the readable
stream. Note that while this default may seem small, it affects the chunk size
of later steps, and after decoding, it could easily be 100x the size, so you're
not recommended to use a larger chunk size. Using a smaller chunk size is
recommended for faster responsiveness; in fact, if responsiveness is key, then
the recommended chunk size is `1`. Note that the reader simply stops reading
packets when it exceeds the chunk size. It will always send complete packets, so
in fact, the chunks will usually be slightly larger than this size.

The only input form accepted for demuxing is input files. Demuxers have the
component `"demuxer"`.

## Encoder

Create an encoder with an `"encoder"` initializer:

```javascript
const out = await TransAVormer.build(libav, {
    type: "encoder",
    videoConfig: {
        /* This is a WebCodecs video configuration, but the `width` and `height`
         * fields are optional, as they will be found from the input. If you
         * don't intend to handle video input, `videoConfig` can be elided. */
        codec: "vp8"
    },
    audioConfig: {
        /* This is a WebCodecs audio configuration. If you don't intend to
         * handle audio input, `audioConfig` can be elided. */
        codec: "opus"
    },
    input: inputData
});
```

All forms are accepted as input to encoders, but the most obvious input is a
frame stream (below).

As well as `videoConfig` and `audioConfig`, which will use WebCodecs if
possible, you can use `libavVideoConfig` and `libavAudioConfig`, which will only
be used by libav.js. Their type is `CodecParameters & AVCodecContextProps`,
i.e., all of the information necessary to initialize a libav.js encoder. This is
much lower level, but exposes some configuration parameters that are not
available in the WebCodecs configs.

## Packet stream selector

You can exclude certain streams by filtering them out with a stream selector.
Create a stream selector for packets with a `"packet-selector"` initializer:

```javascript
const out = await TransAVormer.build(libav, {
    type: "packet-selector",
    selection: "v0",
    input: {
        type: "demuxer",
        ...
    }
});
```

The `selection` field describes which streams to *keep*. It can be an array to
keep multiple (categories of) streams, or just a single selection. Each
selection can have one of three forms:

* A number, in which case, the stream with the given index is kept. e.g., `0` to
  keep stream 0.

* A string. The first character of the string may be `v` or `a` to refer to
  video or audio streams, respectively. After the type character, the rest of
  the string may be a decimal integer, representing the particular track index.
  If the decimal component is absent, all tracks of the given type are selected.
  For instance, `"v0"` requests that the first video track be selected (*not*
  necessarily track 0, as track 0 may be an audio track, but the 0th *video*
  track). `"a"` requests that all audio tracks are selected. `"1"` requests that
  the second track (of any type) is selected. `""` requests that all tracks are
  selected.

* An object with a request description, of the following form: `{type: "video"
  | "audio" | "all", selection: number | "all" | "none"}`. This is basically an
  expanded form of the string selector.

## User packet streams

You can create your own packet stream by creating the codec parameters and
packets (in libav.js format) yourself. To do so, use a `"packet-stream"`
initializer:

```javascript
const out = await TransAVormer.build(libav, {
    type: "packet-stream",
    streams: streams /* array of StreamParameters */,
    input: packetStream /* ReadableStream of Packet[] */
});
```

You can also provide a `ReadableStream` of `number[]`, pointers to packets in
the libav.js memory space.


# Frame stream

Frame streams have the following form:

```typescript
{
    streamType: "frame" | "libav-frame" | "webcodecs-frame",
    streams: Promise<StreamParameters[]>,
    stream: ReadableStream<StreamFrame[]>,
    sendCommands: (cmds: Command[]) => Promise<CommandResult[]>
}
```

The `streamType` is `"frame"` if the input can be a mix of libav.js frames and
WebCodecs frames, or `"libav-frame"` or `"webcodecs-frame"` if it cannot.

`StreamFrame` has the following form:

```typescript
{
    streamIndex: number,
    frame: Frame | number | VideoFrame | AudioData
}
```

Like packet streams, frame streams can have a number of embedded streams
(presumably previously muxed together), but none of the underlying frame types
support specifying a stream. Hence, it's added as a wrapper object.

The many types of `frame` come from the many ways that uncompressed frames can
be created. `Frame` is a libav.js frame, `number` is a libav.js frame pointer
(you will only get pointers if you specifically ask for them), `VideoFrame` is a
WebCodecs video frame, and `AudioData` is a WebCodecs audio frame.

There are five initializers capable of creating frame streams: decoder, filter,
playback normalizer, frame selector, and user frame stream.

## Decoder

Create a decoder with a `"decoder"` initializer:

```javascript
const out = await TransAVormer.build(libav, {
    type: "decoder",
    input: inputData
});
```

Packet streams and input files (or initialiers for packet streams or input
files) are accepted as input to decoders. Frame streams cannot be provided
directly as input to a decoder.

All codec parameters are determined and arbitrated by the `streams` parameter of
`input`, so no codec information is required (or allowed) in the initializer.

## Filter

TransAVormer supports filtering using libavfilter. At present, only filterchains
are allowed, not filtergraphs (that is, you cannot split or combine streams in
filters).

Create a libav filter with a `"la-filter"` initializer:

```javascript
const out = await TransAVormer.build(libav, {
    type: "la-filter",
    videoFilters: "crop=320:240",
    videoIOSettings: {
        // Optional output parameters for video streams
    },
    audioFilters: "volume=0.5"
    audioIOSettings: {
        // Optional output parameters for audio streams
    },
    input: inputData
});
```

All four of `videoFilters`, `videoIOSettings`, `audioFilters`, `audioIOSettings`
are optional.

The filters are strings describing filterchains in libav's syntax. If either is
absent, then that kind of data will not be filtered.

The I/O settings are libav.js `FilterIOSettings`. If absent, the output
properties will be the same as the input properties.

## Playback normalizer

Though playback is not the primary purpose of TransAVormer, it is capable of
being used for decoding for playback purposes. The playback normalizer is
designed to convert the various formats that video and audio frames may take
into consistent formats suitable for playback.

Create a playback normalizer with a `"play-normalizer"` initializer:

```javascript
const out = await TransAVormer.build(libav, {
    type: "play-normalizer",
    sampleRate: ac.sampleRate,
    channels: ac.destination.channelCount,
    input: inputData
});
```

`sampleRate` is mandatory. Audio data will be resampled to the given sample rate
for playback. `channels` is optional but recommended; audio data will be mixed
or split to the selected number of channels.

Frames coming out of a playback normalizer are in one of three
playback-optimized formats:

 * WebCodecs VideoFrames. If `VideoFrame` is supported, then all video frames
   will be converted to WebCodecs VideoFrames, as they can be drawn directly on
   a canvas.

 * libav.js video frames with ImageBitmap data. If `VideoFrame` is not
   supported, then instead, video frames will be converted into an unusual (but
   playable) format: libav.js `Frame` objects, but instead of `data` containing
   raw pixel data, it will contain an `ImageBitmap` of the pixel data. This can
   be drawn directly on a canvas.

 * libav.js audio frames with planar floating-point data. Planar floating-point
   audio data—that is, arrays of float arrays—is expected by most of the web
   audio API.

You can tell the difference between the three by their constituent fields.
WebCodecs VideoFrames have a `codedWidth` field. libav.js video frames have a
(non-zero) `width` field. libav.js audio frames have a (non-zero) `sampleRate`
field.

See `demo/player.html` for a complete playback example.

All input forms are valid for play normalizers, but the obvious input form is a
frame stream. Play normalizers have the component `"play-normalizer"`.

## Frame stream selector

To avoid extra processing steps, it is far wiser to select *packets* than
frames, but an equivalent selector at the frame level is provided.

Create a stream selector for frames with a `"frame-selector"` initializer:

```javascript
const out = await TransAVormer.build(libav, {
    type: "frame-selector",
    selection: "v0",
    input: {
        type: "decoder",
        ...
    }
});
```

The `selection` field is identical to the packet selector's `selection` field.

## User frame streams

You can create your own packet frame by creating the codec parameters and frames
yourself. The frames can be in libav.js format or WebCodecs format, or any
combination thereof. To do so, use a `"frame-stream"` initializer:

```javascript
const out = await TransAVormer.build(libav, {
    type: "frame-stream",
    streams: streams /* array of StreamParameters */,
    input: packetStream /* ReadableStream of StreamFrame[] */
});
```


# Output file streams

Output file streams have the following form:

```typescript
{
    streamType: "file",
    stream: ReadableStream<{position: number, data: Uint8Array}>,
    sendCommands: (cmds: Command[]) => Promise<CommandResult[]>
}
```

Note that this is a stream of write operations *with their positions*. As a
consequence, this streaming format supports file formats that require random
access. Depending on how the stream is made, random access may not actually be
used (that is, the output file may be simply the concatenation of each `data`
element).

There is only one initializer capable of creating a file stream: muxer.

## Muxer

Create a muxer with a `"muxer"` initializer:

```javascript
const out = await TransAVormer.build(libav, {
    type: "muxer",
    format: "matroska", // libavformat format name
    randomAccess: false, // Optional, may be true
    input: inputData
});
```

All input forms are accepted, and extra steps will be added as necessary. The
format must be a libavformat name (which is not necessarily the same as the file
extension). If `randomAccess` is not specified or is false, a strictly streaming
file stream will be created, but this doesn't work for all formats. For example,
to output in the `mp4` format, you must set `randomAccess` to `true`.
