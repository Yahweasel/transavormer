/*
 * Copyright (c) 2024 Yahweasel
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED “AS IS” AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
 * SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
 * OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
 * CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

import * as ifs from "./interfaces";

/**
 * Get the stream→stream mapping for this set of streams and this selection.
 */
export function mkMapping(
    streams: ifs.StreamParameters[],
    selectionIn: ifs.Selection | ifs.Selection[]
) {
    // Canonicalize the selection
    const selection: ifs.SelectionFull[] = [];
    const selectionArr: ifs.Selection[] =
        ((<ifs.Selection[]> selectionIn).length)
        ? (<ifs.Selection[]> selectionIn) : [<ifs.Selection> selectionIn];
    for (const sel of selectionArr) {
        if (typeof sel === "number") {
            selection.push({
                type: "all",
                selection: sel
            });
        } else if (typeof sel === "string") {
            let sel0 = sel[0];
            let sel1 = sel;
            if (sel0 === "v" || sel[0] === "a")
                sel1 = sel.slice(1);
            selection.push({
                type: (sel0 === "v") ? "video" :
                      (sel0 === "a") ? "audio" :
                      "all",
                selection: (sel1.length) ? +sel1 : 0
            });
        } else {
            selection.push(sel);
        }
    }

    // And make the mapping
    const ret: number[] = Array(streams.length).fill(-1);
    let outCount = 0;
    for (const sel of selection) {
        if (sel.selection === "none") continue;
        if (sel.selection === "all") {
            // Map everything (of some type)
            for (let i = 0; i < ret.length; i++) {
                if (ret[i] >= 0) continue;
                if (
                    sel.type === "all" ||
                    (streams[i].codec_type === 0 /* video */ && sel.type === "video") ||
                    (streams[i].codec_type === 1 && sel.type === "audio")
                ) {
                    ret[i] = outCount++;
                }
            }
            continue;
        }

        // Otherwise, we have to actually look for the appropriate index
        let idx = 0;
        for (let i = 0; i < ret.length; i++) {
            if (
                sel.type === "all" ||
                (streams[i].codec_type === 0 && sel.type === "video") ||
                (streams[i].codec_type === 1 && sel.type === "audio")
            ) {
                if (idx === sel.selection) {
                    // Choose this one
                    if (ret[i] < 0)
                        ret[i] = outCount++;
                    break;
                }
                idx++;
            }
        }
    }

    return ret;
}