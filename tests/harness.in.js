/*
 * Copyright (C) 2023-2025 Yahweasel and contributors
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
 * SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
 * OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
 * CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

@E6 import * as fs from "fs/promises";
@E6 import * as TransAVormer from "../dist/transavormer.mjs";
@E6 import * as AVGuesser from "../../avguesser/dist/avguesser.mjs";
@E6 import * as LibAV from "../../libav.js/dist/libav-all.mjs";

@E6 let TransAVormerTestHarness;

TransAVormerTestHarness = {
    tests: [],
    files: [],
    options: {},
    data: {},
    utils: {},

    libav: null,

    loadTests: async function(list) {
        const AsyncFunction = (async function(){}).constructor;

        this.tests = [];
        for (const test of list) {
            let js;
            if (typeof process !== "undefined") {
@E6             js = await fs.readFile(`tests/${test}`, "utf8");
@E5             js = await (require("fs/promises").readFile(`tests/${test}`, "utf8"));
            } else {
                const resp = await fetch(`tests/${test}`);
                const ab = await resp.arrayBuffer();
                const tdec = new TextDecoder();
                js = tdec.decode(new Uint8Array(ab));

            }

            this.tests.push({
                name: test,
                func: AsyncFunction("h", js)
            });
        }
    },

    readFile: async function(name) {
        if (typeof process !== "undefined") {
@E6         return fs.readFile(name);
@E5         return require("fs/promises").readFile(name);
        }

        const resp = await fetch(name);
        const ab = await resp.arrayBuffer();
        return new Uint8Array(ab);
    },

    readCachedFile: async function(name) {
        for (const file of this.files) {
            if (file.name === name)
                return new Uint8Array(await file.content.arrayBuffer());
        }
        return null;
    },

    LibAV: async function(init) {
@E5     if (typeof LibAV === "undefined") {
@E5         // Load libav.js
@E5         const toImport = `../../libav.js/dist/libav-all.dbg.js`;
@E5         LibAV = {};
@E5         if (typeof process !== "undefined")
@E5             require(toImport);
@E5         else if (typeof importScripts !== "undefined")
@E5             importScripts(toImport);
@E5         else {
@E5             // Assume web
@E5             await new Promise(function(res, rej) {
@E5                 const scr = document.createElement("script");
@E5                 scr.src = toImport;
@E5                 scr.onload = res;
@E5                 scr.onerror = rej;
@E5                 document.body.appendChild(scr);
@E5             });
@E5         }
@E5         if (this.libav) {
@E5             this.libav.terminate();
@E5             this.libav = null;
@E5         }
@E5     }

        if (init)
            return LibAV.LibAV(init);

        if (this.libav)
            return this.libav;

        return this.libav = await LibAV.LibAV();
    },

    LibAVW: function() {
        return LibAV;
    },

    avguess: async function(header) {
@E5     if (typeof AVGuesser === "undefined") {
@E5         const toImport = `../../avguesser/dist/avguesser.js`;
@E5         if (typeof process !== "undefined")
@E5             AVGuesser = require(toImport);
@E5         else if (typeof importScripts !== "undefined")
@E5             importScripts(toImport);
@E5         else {
@E5             await new Promise(function(res, rej) {
@E5                 const scr = document.createElement("script");
@E5                 scr.src = toImport;
@E5                 scr.onload = res;
@E5                 scr.onerror = rej;
@E5                 document.body.appendChild(scr);
@E5             });
@E5         }
@E5     }

        return AVGuesser.guess(header);
    },

    TAV: async function(init) {
@E5     if (typeof TransAVormer === "undefined") {
@E5         const toImport = `../dist/transavormer.js`;
@E5         if (typeof process !== "undefined")
@E5             TransAVormer = require(toImport);
@E5         else if (typeof importScripts !== "undefined")
@E5             importScripts(toImport);
@E5         else {
@E5             await new Promise(function(res, rej) {
@E5                 const scr = document.createElement("script");
@E5                 scr.src = toImport;
@E5                 scr.onload = res;
@E5                 scr.onerror = rej;
@E5                 document.body.appendChild(scr);
@E5             });
@E5         }
@E5     }

        return await TransAVormer.build(await this.LibAV(), init);
    },

    print: console.log,
    printErr: console.error,
    printStatus: console.error,

    runTests: async function() {
        let fails = 0;

        this.files = [];

        let idx = 0;
        for (const test of this.tests) {
            idx++;
            this.printStatus(
                `${idx}/${this.tests.length}: ` +
                test.name);
            try {
                await test.func(this);
            } catch (ex) {
                this.printErr("\n" +
                    `Error in test ${test.name}\n` +
                    `Error: ${ex}\n${ex.stack}`);
                fails++;
            }
        }

        this.printStatus("");
        this.printErr(`Complete. ${fails} tests failed.`);

        return fails;
    }
};

@E6 export default TransAVormerTestHarness;
@E5 if (typeof module !== "undefined")
@E5     module.exports = TransAVormerTestHarness;
