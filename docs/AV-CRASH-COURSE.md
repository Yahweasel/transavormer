TransAVormer is a digital audiovisual transformation framework. To understand
that, you need to understand a fair amount of digital media terminology.

This document describes all digital media terms that are necessary to understand
and effectively use digital media transformations. I apologize some of this
comes across a bit elementary, but ask you to still read—or at least skim—the
entire document. I can't know what you do and don't know.

Each section of this document is subdivided into a video and audio subsection,
as the details are often quite different for the two. As well as video and
audio, digital multimedia files may contain subtitles and metadata, but these
are not covered in this document, as they are, quite frankly, fairly trivial.


# Frames

Digital media is always divided in time into *frames*. Most people are
accustomed to frames of video, but audio is divided into frames as well.

## Video

Truly continuous video data is impractical (probably impossible), so video data
is simply a sequence of pictures, fast enough to trick human persistence of
vision into perceiving it as continuous information. Those individual pictures
are called frames. In modern digital systems, it's usually possible for the
frames to change at any rate, and even for the rate to vary depending on the
needs of the scene, but in practice, almost all video is recorded at some fixed
rate, expressed in frames per second. Common framerates are 24, 25, 30, 50, and
60, as well as (for weird American reasons) 24000/1001, 30000/1001, and
60000/1001.

The actual light and color information in a video frame can be stored in various
different formats. The most common is known as YUV 4:2:0, but YUV 4:4:4, RGB24,
and RGBA are also fairly common. Ultimately, these formats are unimportant for
using TransAVormer, but they're terms you may encounter.

The goal of a digital video system is to get frames out of a file (or protocol,
stream, whatever) and onto a display at the correct rate.

## Audio

For similar reasons to video, truly continuous audio data is impractical in the
digital domain. Audio is pressure waves in air, so the simplest non-continuous
way of storing that information is to sample the air pressure at some point
rapidly, typically at least 40,000 times per second. That sequence of samples
can then drive an actuator to push air and create a similar pressure sequence,
recreating the audio. The device that samples audio pressure is called a
microphone, and the device that reproduces it is called a speaker.

The rate at which you sample audio, called the sample rate, affects the fidelity
of the audio, but only to a certain point. Basically, you only need to sample at
double the maximum audio frequency you want to capture. Human hearing typically
goes up to around 16,000Hz, so at least 32,000 samples per second are needed to
accurately reproduce everything a human can hear. Of course, a bit of headroom
is needed as well, so typical sample rates are at least 40,000. 44,100 is
commonly seen because it's what's used by CD audio, but it's impractical for
virtually any other purpose, since it doesn't divide nicely by any of the video
frame rates we saw above. Thus, 48,000 samples per second has largely displaced
44,100 as the “standard” rate, since it divides every common framerate.

Even though this sample rate renders audio non-continuous, it's still
impractically high for real systems. A thread that needs to produce a new sample
48,000 times a second needs to be scheduled 48,000 times a second. So, instead,
audio is *also* delivered in frames, which are simply chunks of samples. Common
audio frame sizes were chosen to coincide with common video frame sizes, but
modern audiovisual formats don't actually depend on that, so different
framerates for audio and video are common.


# Formats and perception

Real visual and auditory data is not digital, of course. It has to be converted
into a digital form to be stored and transmitted in a computer. There are two
aspects of this conversion: representation and compression. This section
describes the former.

## Video

Visual information in reality is extraordinarily complex. Luckily, human vision
is fairly limited. The digital encoding of visual information is *always*
designed to satisfy the requirements of human vision only.

Each retina of the human eye captures a two-dimensional image. Human
three-dimensional vision is reconstructed by the human mind from two
two-dimensional images, and is very limited. On the rare occasion that video is
three-dimensional, it's actually just two two-dimensional images. So, we can
focus here just on two-dimensional images.

In order to digitize a two-dimensional image, it is divided into pixels. Pixels
are simply square (or sometimes rectangular) portions of the larger array, each
of which is assigned a single color. If the pixels are small enough, then human
visual acuity is unable to discern that they are small uniform squares rather
than a continuous plane.

### Resolution

The number of pixels in an image is its resolution. This is why cameras are
described in terms of “megapixels”: that is how many (millions of) pixels are in
the images they produce. Also important is the shape of the image. Most—in fact,
almost all—images are rectangles, so this shape is described in terms of their
aspect ratio, which is the ratio of their width to their height. For example, a
4:3 image is 4x wide and 3x tall for some x. The resolution and aspect ratio can
be described simultaneously by giving the width and height of an image in
pixels, for instance, 1920x1080 describes a 16:9 image with roughly 2
megapixels. Quite often, both of these properties are described as “resolution”.

(Brief side note: If the pixels aren't square, then the width-by-height
resolution does not, in fact, describe the image's aspect ratio. Non-square
pixels are rare enough that it is usually sufficient to just mention this
separately.)

Unfortunately, resolutions and aspect ratios have many bizarre names, far too
many of which make no sense. The most egregious family of these names is, e.g.,
“4K”, in which “K” seems to mean “2 megapixel”. I recommend using the
width-by-height convention wherever pracical.

With pixels, we know how an image is split up by space, but we still need to
discuss what is actually *in* each pixel.

### Color perception

Human retinae have “rod” and “cone” cells. The former distinguish light from
dark, and the latter distinguish different colors. Of course, for something to
have a color it must give off some light, so these are related. We will focus
first on color.

We do not have cone cells for every possible color of light. Rather, we only
have three classes of cone cells, and thus can only see three colors. These are
usually referred to as red, green, and blue, and for the purposes of this
document, those will be sufficient, but note that the sensitivities of these
cells don't actually align well to these colors. Alternatively to thinking of
each pixel in these terms, we can think of the whole image as being decomposed
into a red image, a green image, and a blue image, each of which are greyscale
image that describe one color (red, green, and blue respectively) of the
complete image.

The way that we see the entire range of colors is by combinations. Yellow is
between red and green, so when we see yellow light, both red and green cells are
stimulated. As such, we can reproduce the experience of yellow light by
producing red and green light simultaneously, and human vision is unable to
distinguish the two phenomena. Thus, all visible colors can be represented as
combinations of red, green, and blue. So, all we need for each pixel is how red
it is, how green it is, and how blue it is. That is, three numbers.

Numbers on a computer are represented in terms of bits, and how many bits each
of red, green, and blue get is called the bit depth. Typically, each gets 8
bits. Greater bit depths aren't really needed for human vision (our vision is
not that precise), but are useful for a more subtle reason: if you record with
more bits, you can expand a part of that range. For instance, if it's too dark,
you can lighten it while still keeping 8 bits worth of depth. As a consequence,
mastered video (i.e., video ready to be played) is usually 8-bit even if the
original recording was 10- or 12-bit.

### Color systems

What we've just described is RGB color. But, recall our discussion of rods and
cones. Humans are more sensitive the light and dark than we are to color. RGB
color conflates the two, so we can't take advantage of this difference in
acuity. In most practical systems, we instead use ways of describing color that
separate lightness from color.

Here are all of the common color systems (not yet accounting for alpha, which
will be discussed later):

 * RGB, already described.

 * HSL and the closely related HSV, which stand for hue-saturation-lightness and
   hue-saturation-value. The distinction between lightness and value is not
   relevant for our purposes. HSL/HSV describe color as rotation around a hue
   circle, which you may have seen in drawing software. A hue of 0° is red, 120°
   is green, and 240° is blue. Hues past 240° are mixtures of blue and red
   (i.e., purples). Saturation describes the difference between a pure color and
   a shade of grey. Unfortunately, HSL isn't very efficient, because the hue
   value is meaningless if the saturation is zero (there are no colors of grey).
   As a consequence, HSL/HSV are often used by artists, but never used to
   actually store image data.

 * YUV and the closely related YCbCr. Y stands for luminance (somehow), i.e.,
   lightness. U and V (or Cb and Cr) describe the color as two degrees of
   rotation. In short, if RGB color is the description of a color vector by its
   lenght in each axis, then YUV is a description of the same color vector by
   its length (Y) and rotation about two axes (U and V, or Cb and Cr). The
   important part is that this separates a single dimension of lightness from
   two dimensions of color in a more efficient way than HSL.

Most images on computers use either RGB or YUV. More specifically, image files
tend to use RGB, while videos tend to use YUV, though there are many exceptions
(for instance, JPEG image files are actually based on YUV).

All three of these color systems predate computers. RGB is human nature. HSL and
HSV are by and for artists. YUV (or, more specifically, YCbCr) come from analog
television.

As well as color *systems*, there is the concept of color *space*. While humans
see in red, green, and blue, they have different sensitivities. How the ranges
of R, G, and B values map to real, physical light can be changed to cover more
(or less) of the space that we can see. The two most common color spaces are
often called SRGB (or JPEG) and TV. If the color space of an image is forgotten,
it may be displayed slightly incorrectly, usually appearing either washed out or
oversaturated. Color systems and color spaces are often conflated.

### Subsampling

With non-RGB color systems in mind, we can now take advantage of humans' lesser
acuity for color to reduce the amount of data needed. We do this by
*subsampling* the color data, which simply means including less color data than
lightness data. This is possible since the YUV color system separates lightness
(Y) from color (U and V).

The most common way of subsampling color is simply to have color images (U and V
images) that are a quarter the size of the luminance image (that is, half in
each dimension). A video player then scales that color images up and combines
them with the luminance image to produce the image it actually displays. This
scaling up cannot create new information, of course, so there is much less color
information than luminance information. That, of course, fits with humans'
reduced color acuity as compared to lightness acuity.

Subsampling in this way, with the color images being a quarter the size of the
luminance image, is called YUV 4:2:0. The “system” by which subsampling in this
way is called “4:2:0” is so incoherent that it's better to simply memorize that
“4:2:0” has that exact meaning. Even if you do choose to learn what these
numbers mean, other subsampling systems use the numbers in different ways, so it
may as well simply be a name.

While YUV 4:2:0 is the most common, there is also YUV 4:2:2 (which has a color
image that's half as wide as the luminance image but has the same height) and
YUV 4:4:4 (which simply means that the color isn't subsampled).

Subsampling of non-YUV color is possible but exceedingly rare. Humans are more
sensitive to green than either red or blue, so some rare file formats include
less red and blue information than green information.

### Putting it together

Each frame in most videos includes a Y image, a U image, and a V image. These
are each called a *plane* of the complete color image. If the video is YUV 4:2:0
subsampled (which most are), then the U and V images are scaled up to match the
U image, and then the three are combined to create a color image. The resolution
of the Y image is the resolution of the video, and the U and V images have
resolutions proportional to that, depending on subsampling.

A video simply consists of many frames in sequence, to be displayed at some
(typically fixed) rate.

## Audio

Audio is one-dimensional, which makes it considerably easier than video, but
audio perception is quite interesting in ways that affect how audio is
described.

As described above in the frames section, audio is sampled as air pressure about
40,000 times per second. Each sample is represented as a number, and like video,
each number is represented in some number of bits. Most audio has 16-bit,
24-bit, or 32-bit samples. For instance, audio CDs have 16-bit samples. There is
the additional complication of integer vs. floating point samples, but that's
beyond the scope of this document. Like in video, this is called the audio's bit
depth.

16 bits is more than sufficient for human auditory acuity, but just like in
video, it can be useful to sample with more detail so that you can expand the
data later. Mastered audio (i.e., audio ready to be listened to) is usually
16-bit even if it was recorded at 24- or 32-bit.

### Volume perception

While the above is a good physical description of sound, sound perception has a
whole array of surprising characteristics. The first is how we perceive volume,
as opposed to amplitude.

The amount of air pressure carried in a sound wave dictates its volume. The raw
amount of pressure is called the amplitude of the wave. But, the relationship
between the amplitude and the loudness we actually perceive is not 1-to-1. If a
sound has double the amplitude, it does not sound twice as loud; in fact, it
only sounds a bit louder. The relationship is logarithmic.

Because of this logarithmic relationship, there are different units for
expressing amplitude than volume. Volume is expressed in decibels, abbreviated
dB. Decibels are scaled such that (x+10)dB is 10 times the amplitude of xdB.
Technically, amplitude is expressed in pascals, but this unit is irrelevant in
digital audio.

Digital audio adds an extra wrinkle to measuring volume (and amplitude): the
volume of any part of a digital file is modulated by the device it's played on
and the environment it's played in. As a consequence, volume in digital audio is
always relative, and specifically relative to the loudest possible sound
(greatest possible power) the speaker playing the audio can produce.

As a consequence of this relative measure, the unit for amplitude is simply
percent. Audio at 50% is half as loud as the speaker can play. Volume of digital
audio is still measured in decibels, but 0dB is defined to be the maximum
volume, which causes the unusual effect that digital audio's volume is always
*negative* decibels; to get to the absolute volume when actually played, you
simply add the maximum volume of the speaker. Typically, audio is in the -20dB
to -15dB range on average, with peaks up to 0dB and soft parts as low as -40dB.

It may seem like a strange choice to use zero to mean “as loud as possible”, but
there's really no better alternative. If you have to choose a magic number,
better to choose zero than some arbitrary value. Note that since decibels are a
logarithmic scale, zero is *not* silence even in absolute terms. Zero amplitude
cannot be measured in decibels (or, alternatively, is negative infinity
decibels).

### Pitch and frequency perception

Sound is a wave of pressure through air (or any other media). How we perceive
that sound depends on various aspects of the shape of that wave.

The closer the repetitions in the wave (the more often it goes through a
complete wave), the higher in pitch the sound sounds. Double the frequency is
one octave. Thus, if you double the speed of music, all the notes will be of the
correct pitch, but up an octave.

But, what distinguishes the sound of an oboe from a violin, or the sound of one
vowel sound from another? That is the *shape* of the wave. If you were to draw
the air pressure over time on a graph, with zero being the ambient pressure,
then the same pitch being played on an oboe or a violin would repeat
(approximately) its pattern at the same frequency, but the nuanced changes
within that overall repetition would be different. Of course, both the shape and
the frequency of a sound can change over time.

The most basic shape for a sound wave to have is the sinusoidal wave, or sine
wave, which is simply the mathematical sine function. The sound of a sinusoidal
wave is pleasant but fairly dull, and sine waves are hard to hear among other
sounds.

Now is where things get the most interesting: any shape of a wave can also be
described as the sum of many simple waves. In fact, the trained musician can
hear these compounded waves; they are called the *overtones* of a sound. The
character of the overtones that an instrument, voice, or indeed anything else
creates is called its *timbre* (pronounced “tamber” because the French language
is even more ludicrous than English).

(Brief side note: to actually use this for digital representation, you also need
the “phase” of each overtone. But, these details are considered far beyond the
point of this document.)

Whether a complex waveform is the sum of its overtones or a complex shape is a
matter of interpretation, and neither interpretation is more correct than the
other. However, describing it as the sum of its overtones does have an
advantage: all sound can be described as the sum of many frequencies over time.
If you've ever seen a spectrogram of audio, you've seen this representation.

One of the most fascinating things about thinking of sound in this way is that
frequency is just the reciprocal of seconds, so frequency over time is
per-seconds-per-second. There is some dividing line (really, more of a blurry
dividing area) where pulses stop sounding individual and start sounding like a
tone; human hearing interprets small timescales radically differently than large
timescales.

Digital audio data can be represented by individual samples or by frequencies,
but ultimately it has to be converted to samples to be played by a speaker. This
conversion is called an inverse Fourier transform, and the transformation from
samples to frequencies is, of course, called a Fourier transform.

### Stereo and surround sound

Humans have two ears (wow!). Thus, all location information we are capable of
discerning comes from only two locations. The way that the brain converts just
two signals into an (albeit rough) three-dimensional map of the soundscape we're
in is extraordinarily complicated.

To try to account for this, audio usually has more than one *channel*. e.g.,
stereo audio has a channel for the left ear and a channel for the right ear.
Surround-sound audio will further separate left-front from left-back, etc.
Ultimately, each channel is just its own sequence of samples, all side-by-side.

Since humans have only two ears, it may seem redundant to have more than two
channels, but it's not. If you're listening to audio in headphones, then
essentially each channel goes to one ear, but if you're listening to it on
speakers, then how it reaches your ears is affected by the environment.
Ultimately, audio “intended” for headphones *cannot* be correct, because
everyone's environment (and even just head size and shape) is different.

Common sets of channels have short (stupid) names of the form *x.0* or *x.1*.
*x* is the number of speakers, excluding any subwoofer. *.0* means there is no
subwoofer channel, and *.1* means that there is. Common configurations, other
than 1.0 (monaural) and 2.0 (stereo) are 4.0, 5.0, 5.1, and 7.1.


# Packets and compression

Video data is so outlandishly large, compressing it is essentially mandatory.
Audio data isn't anywhere near as large, but it's still big enough to be worthy
of compression.

A method of compression (and decompression) is called an *encoding*, and a piece
of software to perform this compression is therefore called an *encoder* (and
the reverse a *decoder*). A piece of software that does both is a *codec*, which
is short for (en)coder-decoder. It used to be common to conflate codecs (which
are particular implementations of encodings) with encodings; for instance,
“DivX” is a codec, not an encoding, but files encoded with DivX were called DivX
files, not MPEG-4 video files. Luckily, that habit seems to have largely
vanished, and modern video encodings are given their proper name, rather than
the name of the software that encoded them. Sometimes encodings are also called
“formats”, and this term isn't wrong, but “encoding” is more specific.

Most encoders express their data in frames, just like the data they're encoding.
There is no universal name for an encoded frame of data, but this document (and
TransAVormer) will call them *packets*, following the standard set by FFmpeg and
libav. Other sources may call them “chunks”, or simply “encoded frames”.

There are two broad categories of compression, for both video and audio:
lossless or lossy. Lossless compression is exactly what it sounds like: data
takes less space, but loses no fidelity. This is possible because a lot of data
is fairly boring; imagine trying to explain a black screen, vs. trying to
describe a complex image. Data which is simpler usually takes less space to
describe, even flawlessly (losslessly). Note that there is an unrelated source
of loss implied by the above discussions of *depth*: if you take, for example,
8-bit RGB video data and convert it to 3-bit YUV 4:2:0 video data, you will lose
information, but not because of compression. A lossless compression encoding is
not considered lossy simply because it doesn't support the depth you wish to
encode.

Lossless compression is better than nothing, but it can usually only achieve
around 33% the size of the original data. That's quite good, but AV data is
*quite* big. Ultimately, the lossless nature of lossless compression restricts
its creativity, and so there are fewer lossless techniques for compressing media
data than there are lossy techniques, and their efficacy is mostly similar. If
you need lossless compression, then for audio, FLAC is widely supported, but
WavPack supports more bit depths. For video, some lossy video encoders (which
will be discussed below) also support a lossless mode, and it is also possible
to use lossless image encodings, such as PNG, as video frame encodings.

Lossy compression achieves smaller sizes by voluntarily losing information. Of
course, this means that it loses quality. All advancements in lossy compression
revolve around minimizing size while maximizing the quality of the data still
retained. Generally, there is a human factor as well: the quality is the quality
according to human perception, not according to a strict mathematical model of
loss.

Because it loses quality, there is a tradeoff in lossy compression between space
(size taken by the encoded data) and quality (how much of the original data is
preserved). The most common way to express this is *bitrate*, i.e., how many
bits are taken for one second of audio or video.

As technology advances, lossy compression improves, and less bitrate is required
to achieve the same quality, yet it's quality that viewers see or hear, so
describing quality as “one megabit” means something very different for an
encoding from 1995 than it does for an encoding from 2020.

More subtly, how much space it takes to describe some detail depends on how
complex the detail is. Thus, the same amount of space that is sufficient to
describe one image or sound in near-perfect detail may be inadequate for another
image or sound. In particular, random noise is very difficult to encode, and
solid areas of color or silence or held tones are very easy. Thus, it's usually
better to fix the quality rather than the bitrate. Many encodings allow you to
fix either of these properties. If you fix the size but allow the quality to
fluctuate, this is called constant-bitrate encoding. If you fix the quality but
allow the size to fluctuate, this is called constant-quality encoding.

## Video

There are two core techniques involved in (lossily) compressing video data:
intraframe compression, and interframe compression.

### Intraframe compression

Intraframe compression (i.e., compressing a single frame using only its own
data) is fundamentally the same problem as compressing image files. The simplest
video encodings, in fact, are exactly that: just a sequence of frames each
compressed independently. An example of this style is MJPEG (motion JPEG), which
is simply a JPEG image file for each frame.

The best way to understand how intraframe compression works is simply to do it
badly. Save a JPEG file with very low quality (say, 1%), then open it again.
What you'll see is a lot of 8-by-8 blocks. Some of them will just be one solid
color; others will have simple gradients. Virtually all intraframe image/video
compression encodings use this same concept: break the image down into blocks of
some fixed size (called *macroblocks*), then describe each block in relation to
some expected pattern, such as a solid field or gradient. Since the JPEG image
in this example was saved with the lowest possible quality, it gave as short
(and thus small) of a description as it could, and thus lost a lot of
information. The more space you use for these descriptions, the more quality is
preserved.

While virtually all intraframe image and video compression encodings use
macroblocks, the details *beyond* that are incredibly diverse. Typically there
are larger and/or smaller blocks describing less/more precise detail, and of
course, exactly how the detail within each block is described varies
considerably from encoding to encoding.

### Interframe compression

In a video, frames are not independent from each other. Typically, if frame B
follows frame A, then it will be substantially similar to frame A, but with some
changes. If frame C follows frame B, then it's likely that some of the changes
between A and B will continue onto C, if you consider changes such as motion—an
object in motion remains in motion, of course.

This logic underpins how video data is stored. Video is stored in “intraframes”
and “progressive frames”, usually abbreviated as I-frames and P-frames. I-frames
are stored as described above, in the “intraframe compression” section. But the
data stored for a P-frame is not sufficient to describe the entire frame.
Instead, a P-frame describes the changes from the previous frame, as motion
vectors as well as changes in lightness and color.

Thus, for instance, if one figure is moving in the frame but others are still,
the P-frame will describe the motion, but will describe nothing at all about the
other characters. The image for non-moving characters is instead just carried
over from the most recent I-frame. If you've ever seen a so-called “datamoshed”
video, you've seen the P-frame divorced from its (correct) I-frame, which lets
you see and understand this motion data.

Since P-frames depend on their most recent I-frame, there is usually a
degredation of quality over time. If you have 600 P-frames in a row, the last
one, even decoded correctly, will not look as good as the I-frame. Thus,
P-frames don't continue indefinitely. At the very least, a decent encoder will
put a new I-frame when the scene changes dramatically (so, everything changes),
but there is typically also a maximum time between I-frames, usually less than a
minute. The period between I-frames is called the “keyframe interval”, and the
set of images that all depend on a given I-frame (plus the I-frame itself) is
called a “group of pictures”.

Also because P-frames depend on their most recent I-frame, it is impossible to
open a file to a random frame and decode successfully from there. You must open
to an I-frame and start from there. It is thus common for file formats to
contain an index that describes where to find all the I-frames.

There is no universal rule of thumb about how large an I-frame is as compared to
how large a P-frame is. Both take as much space as the quality requires of them,
and as much space as the data requires of them. But, typically, one can expect
I-frames to be hundreds of times the size of P-frames.

As well as P-frames, some codecs support “B-frames” (before-frames?), which are
simply P-frames reversed. That is, they describe a frame that comes *before* an
I-frame. This means that the frames have to be encoded out of order, as you must
decode the later I-frame first, but allows the maximum quality (the I-frame) to
be placed nearer to the middle of the group of pictures instead of at the
beginning. Since the quality of a P-frame degrades in relation to its distance
from the I-frame, placing the I-frame in the middle allows less loss. In
practice, however, the I-frame is usually only one to four frames into a GOP, as
processing many B-frames to be able to display the first one takes time.

### Common encodings

Which encoding is common at any given time changes as technology evolves.
Thankfully, video formats found commonly have kept up as video encoding
techniques have improved.

Historically, the Misanthropic Patent Extortion Gang (MPEG) dominated the entire
space of video encodings, and many of their encodings remain popular. Very few
organizations or people in this world are unambiguously evil, but MPEG is one of
them. MPEG does not develop anything; they are a consortium the pools ideas (and
patents), and as time has gone on, their priority has changed from pooling the
best ideas to pooling the ideas most encumbered by the most patents. MPEG
technology should be avoided wherever possible.

A modern video codec that is just starting (as of the writing of this document)
to get widespred use is AV1. AV1 was created by a consortium created as a
response to MPEG, the Alliance for Open Media, and is unencumbered by patents.

On the web, the VP9 codec is still quite popular; it was created by Google to be
an open codec, and while it was perfectly acceptable for its time, it's not
especially remarkable as compared to AV1.

VP9's predecessor was VP8, but VP8 had less uptake.

MPEG's most recent codecs are named H.`some number`, e.g., H.265. H.266
technically exists, but MPEG has become a joke, so no one uses it. H.265's
patent situation is so absurd that it's not clear if there is any legal way for
an entity that's not in MPEG to use it; it got a small amount of uptake in
certain industrial standards (including digital TV), but little else. H.264 is
enormously popular, but is still encumbered by patents. H.264 is probably the
most popular video codec as of the time of this writing.

H.264's predecessor is H.263 (wow!), but the MPEG codec based on H.263 is
slightly changed, so it doesn't have that name. It's officially called MPEG-4
Part 2, but it's widely known by the name of a popular codec, DivX. Though DivX
was enormously popular in its time, it is now all but dead.

The predecessor to H.263 was H.262, which is also known as MPEG-2 Part 2 or
MPEG-2 video, and its predecessor is H.261, also known as MPEG-1 Part 2 or
MPEG-1 video.

Before H.264 became popular, there were hundreds of minor video codecs used for
special purposes. Nowadays, virtually all video is H.264, AV1, or VP9.

## Audio

There is no similar concept of intra- and inter-frame compression in audio. All
audio data is described as changes, but it's valid to start from anywhere, as
the effect of describing audio data as a change from nothing is usually to
simply fade in.

The core concept behind lossy compression of audio is describing the overtones
in as little detail as is feasible. The simplest (and worst) audio compression
imaginable would simply perform a Fourier transform, then choose only the
loudest overtones to describe per each frame. In practice, on top of this, you
must allow tones to change over the course of a frame, and the loudest overtones
are not necessarily the correct ones for human perception.

You may have heard buzzing or ringing sounds in badly compressed audio. These
sounds are the result of removing overtones, which results in the remaining
tones being “naked”, so to speak, which makes them more noticeable.

Beyond this basic concept of performing a Fourier transform and analyzing the
overtones, audio encodings are astonishingly diverse. Most have some concept of
“psychoacoustics”, i.e., how they describe sound is influenced by the psychology
of audio perception. Some even have different models for voice than for other
sounds.

While audio data does not have distinct I-frames and P-frames, the data is
nonetheless described in terms of how it's changed from the previous frame. When
seeking in a file, the codec generally assumes that the previous frame was
silent. It rarely takes more than 60ms worth of data for this false start to no
longer have any effect on the audio, but some audio encodings define this
interval more precisely. An audio processor should choose whether to start
decoding early (so as to get the audio data more correct) based on its intended
use, as this is less important for playback than for, e.g., compositing audio.

### Common encodings

Like with video, for a time, audio encoding was dominated by the Misanthropic
Patent Extortion Gang (MPEG). Unfortunately, there's a far stupider problem that
has infected the world of audio.

For some reason, a lot of people have gotten stuck to MP3 (which is an
abbreviation of MPEG-1 Layer 3 Part 3), which is such an outlandishly ancient
codec that its successor's successor's successor's successor has been obsolete
for over a decade. [Friends don't let friends use
MP3](https://ecastr.com/rants/mp3/).

When people aren't stuck in the MP3 timewarp, the popular options are an open
codec named Opus, and MPEG's AAC. I would hesitate to even guess which of these
two is more popular, since the whole space is awash in MP3 nonsense.

Opus is just plain better than AAC. Other than some experiments in using AI for
audio codecs, no one has matched Opus's quality-per-bitrate as of the time of
this writing. However, it is restricted to stereo or mono audio.

AAC remains popular probably because of its association (by way of MPEG) with
H.264, as well as because it's the format used by iTunes. AAC has many
sub-versions with weird names (AAC-LE, HE-AAC, HE-AACv2, etc etc), so it is
actually many encodings over time, all given a single name.

Prior to Opus, the popular non-patent-encumbered audio codec was Vorbis. Vorbis
was actually quite popular in video games, because video game developers don't
want to deal with patents any more than you do. Nowadays, Vorbis has been almost
completely replaced by Opus.


# Multiplexing and file formats

If all you have is video, or all you have is audio, then in theory the way that
data could be written to disk or communicated across a network is to simply
place each packet, one-by-one, in the order that they are to appear (or, in the
case of B-frames, in the order that they are to be decoded). Then, you would
simply need some header to say what kind of data it is, and the data could be
decoded. But, if you want audio *and* video data, then it's generally less
practical to store them as two separate files than it is to put them together in
one. Thus, we need a way of interleaving video and audio data together, so that
it can be read and decoded in the right order for the video and audio to
correspond correctly when presented. Indeed, this concept of interleaving audio
and video data is immortalized in the name of one of the classic file formats
for this task: AVI stands for Audio Video Interleave. This interleaving process
is also called *multiplexing*, and extracting the packets from a multiplexed
file is called *demultiplexing*.

In order to know when to present data, a multiplexing format must at least
provide a timestamp for every frame. And, of course, it will ideally put them in
timestamp order (or, in the case of B-frames, in the order they need to be
decoded). These timestamps will be given in some *timebase*. For instance, if
the timebase is 1/1000, then the timestamps are in milliseconds.

Almost no multiplexing formats are restricted to only one codec. As a
consequence, if all you know is that a file is, for instance, a .avi file, you
have no way of knowing its quality. There's a lot of “common wisdom” about which
media file formats are better than others in terms of quality, but it's all
hokum. A .avi file with AV1 data in it is just as high in quality as that AV1
data in any other file. Unfortunately, there is simply no way to know from a
file extension anything about the quality of the data inside.

The goals of a media file format are:

 * To store audio and video data—in some cases as well as other data such as
   subtitles—in an order that is conducive to decoding and presenting.

 * To store enough metadata about the data that the correct codec can be found
   and initialized. The metadata required to initialize a codec is called the
   “extradata” in FFmpeg/libav terms, and the “description” in WebCodecs terms,
   but it is completely codec-specific.

Any given format might have additional goals, such as

 * Streamability. This doesn't necessarily refer to streaming in the sense of
   streaming video over a network, but to the ability to write the data in order
   from start to finish without having to go back. The reason why a format might
   *not* be streamable is indexing, our next goal.

 * Seekability. A format is seekable if you can jump to a given time within the
   file and play from there. Remember, each encoded frame takes a different
   amount of space, so we cannot simply blindly jump into the middle of the
   file. Most file formats include an *index* that contains information on which
   locations in the file correspond to which time. Without an index, it is
   either necessary to be able to distinguish a packet from other data (so that
   you can grope around in the file for a packet), or to start from the
   beginning every time you read the file. Even without an index, most formats
   provide some way to find a packet in the middle of the file, so that you can
   seek by dead reckoning.

 * Networkability. If data is intended to be sent over a network, it's valuable
   to (a) make sure that there is some exact correspondence between data packets
   and network packets, and (b) be able to distinguish crucial packets
   (I-frames) from best-effort packets (P-frames). If I-frames are lost, the
   video can't be played; if P-frames are lost, you miss a frame.

These goals often conflict, and the bikeshedding of these goals is why there are
such a staggering number of media file formats. Three of the major ones will be
discussed here.

## MPEG-4/ISOBMF

MPEG-4's container format (usual extension .mp4) is a chimera of a format, with
at least two common names other than MPEG-4: the ISO Base Media Format (ISOBMF)
and Apple MOV. It's called Apple MOV because it was actually Apple's MOV format
long before it became standardized as MPEG-4—remember, MPEG doesn't actually
make anything, they just gather things others have made. It's called ISOBMF
because it was *also* standardized by the International Standards Organization.

Technically these standards vary slightly, but only in what encodings the data
contained within are allowed to have. The MPEG-4 standard itself only describes
MPEG-4 files with MPEG-4 data. Apple's MOV additionally allows various Apple
encodings. ISOBMF is the most broad, and describes how to include lots of
encodings. All of them are nonetheless typically named .mp4, so I'll refer to
all of them as MPEG-4.

MPEG-4 is seekable. It's possible to write an MPEG-4 file with the index at the
beginning, in which case it's also networkable, but this is often not the
default, because the index is only known at the end. In FFmpeg/libav, for
example, you must set the `movflags` option to `faststart` to move the index to
the beginning.

MPEG-4 is not streamable. It is not safe to record data to MPEG-4 data “live”,
in a streaming manner, because if the recording is cut off for any reason and
the index is not written, the data is usually unrecoverable. Many a naïve user
has lost hours of recording data due to using this unsuitable format for
recording. Note that this fact isn't actually a complaint about MPEG-4; it's
fine for different formats to have different purposes.

Video streams in MPEG-4 can have various timebases. Audio streams have the
reciprocal of the sample rate as their timebase. Note that this means that
different streams may have different timebases.

### Quasi-aside: ISMV

ISMV is a subformat of MPEG-4 created by Microsoft to make MPEG-4 streamable.
In short, it makes an MPEG-4-like streamable file by (sort of) treating every
frame as a complete file with its own metadata. This modification isn't
technically allowed by the MPEG-4 standard, so ISMV files aren't technically
MPEG-4 files. But, virtually all if not all readers capable of reading MPEG-4
will read ISMV files just fine, so if you need the MPEG-4 format but you also
need streamability, ISMV will usually suffice.

## Matroska/WebM

Matroska (usual extension .mkv) is a format that was created to be very general.
Virtually all encodings can be stored in Matroska, and for any encoding that
doesn't have a defined way of storing it in Matroska, it is almost certain that
someone will define it.

As a consequence of Matroska's generalness, seeing a .mkv file tells you even
less about what's in it than seeing a .mp4 file. As a consequence, to make
things more predictable, Google created a restricted subset of Matroska called
WebM. WebM may only contain certain video and audio codecs. Periodically the
list is amended, but at the time of this writing, the supported video codecs are
AV1, VP9, and VP8, and the supported audio codecs are Opus and Vorbis. Other
than that restriction (and the removal of an optional component in Matroska
that's not relevant here), Matroska and WebM are the same. All WebM files are
valid Matroska files.

Because of solving-too-many-problems-ism, many features of Matroska aren't
guaranteed in all Matroska files.

Matroska is *usually* seekable, but the index is technically optional. Usually
the index would only be missing if the file was recorded live and the recording
was cut off without ending cleanly.

Matroska is streamable and networkable. Streamed Matroska files will only be
correctly seekable of the index is correctly written at the end.

All streams in Matroska use milliseconds as the timebase. This is, frankly,
inadequate, and players usually have to be careful about timing to make sure
things remain seamless.

## Ogg

Ogg (extensions include .ogg, .ogv, .oga, and .opus) is a format that was
created to be astonishingly simple. This crash course has only scratched the
surface of the concerns involved in most of these formats, but we've covered all
the concerns required by Ogg.

While Ogg is not especially popular, it has some small popularity from its
association with several well-known encodings. Vorbis files were almost always
distributed in the Ogg format, and Opus files that don't have video are
distributed as Ogg with reasonable frequency, though using WebM for this purpose
is common as well.

Only a few encodings are supported in Ogg, and in particular, very few video
encodings are supported.

Ogg has no index, but has facilities to find a packet in the middle of a file,
making it somewhat seekable.

Ogg is streamable and designed to be easily adapted to the network.

Ogg itself does not define what timebase any stream should use. Instead, the
documentation for embedding each encoding into Ogg is expected to document the
timebase to use. Typically, fixed-framerate video uses the reciprocal of the
framerate as its timebase, and variable-framerate video will have various
timebases depending on the encoding. Audio usually uses the reciprocal of its
sample rate as its timebase.
