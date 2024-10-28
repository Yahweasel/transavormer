# TransAVormer

TransAVormer is a (largely) stream-based frontend for
[libav.js](https://github.com/Yahweasel/libav.js) and
[WebCodecs](https://w3c.github.io/webcodecs/). It is a system for
trans-everything-ing video and audio data in a browser. By
“trans-everything-ing”, I mean transmuxing and transcoding, but also simply
demuxing, decoding, encoding, muxing, filtering, or most other streaming
transformations to digital audiovisual media.

This is just a brief introduction to TransAVormer. The API is documented in
[docs/API.md](docs/API.md).

Exactly which formats and codecs TransAVormer supports depends on which variant
of libav.js you're using. Thus, you must bring your own libav.js instance.

TransAVormer provides only a single function, `build`, which builds
transformers. It takes an initializer that describes the transformation you with
to perform, and figures out any other transformation steps that are necessary
based on its input.

For instance, suppose you have an MP4 file as a `File` object, and you wish to
transmux it into a Matroska file. That can be achieved like so:

```javascript
const libav = await LibAV.LibAV();
const muxer = await TransAVormer.build(libav, {
    type: "muxer",
    randomAccess: true,
    input: inputFile
});
const rdr = muxer.stream.getReader();
const out = new FileWriter("out.mkv"); // Hypothetical output class
while (true) {
    const rd = await rdr.read();
    if (rd.done) {
        out.close();
        break;
    }
    out.write(rd.value.data, rd.value.position);
}
libav.terminate();
```

If you also wanted to transcode it into, say, VP8 and Opus, you could replace
the build call with this:

```javascript
const muxer = await TransAVormer.build(libav, {
    type: "muxer",
    randomAccess: true,
    input: {
        type: "encoder",
        videoConfig: {
            codec: "vp8"
        },
        audioConfig: {
            codec: "opus"
        },
        input: inputFile
    }
});
```
