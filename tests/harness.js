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
                js = await (require("fs/promises").readFile(`tests/${test}`, "utf8"));
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
            return require("fs/promises").readFile(name);
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
        if (typeof LibAV === "undefined") {
            // Load libav.js
            const toImport = `../../libav.js/dist/libav-all.dbg.js`;
            LibAV = {};
            if (typeof process !== "undefined")
                require(toImport);
            else if (typeof importScripts !== "undefined")
                importScripts(toImport);
            else {
                // Assume web
                await new Promise(function(res, rej) {
                    const scr = document.createElement("script");
                    scr.src = toImport;
                    scr.onload = res;
                    scr.onerror = rej;
                    document.body.appendChild(scr);
                });
            }
            if (this.libav) {
                this.libav.terminate();
                this.libav = null;
            }
        }

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
        if (typeof AVGuesser === "undefined") {
            const toImport = `../../avguesser/dist/avguesser.js`;
            if (typeof process !== "undefined")
                AVGuesser = require(toImport);
            else if (typeof importScripts !== "undefined")
                importScripts(toImport);
            else {
                await new Promise(function(res, rej) {
                    const scr = document.createElement("script");
                    scr.src = toImport;
                    scr.onload = res;
                    scr.onerror = rej;
                    document.body.appendChild(scr);
                });
            }
        }

        return AVGuesser.guess(header);
    },

    TAV: async function(init) {
        if (typeof TransAVormer === "undefined") {
            const toImport = `../dist/transavormer.js`;
            if (typeof process !== "undefined")
                TransAVormer = require(toImport);
            else if (typeof importScripts !== "undefined")
                importScripts(toImport);
            else {
                await new Promise(function(res, rej) {
                    const scr = document.createElement("script");
                    scr.src = toImport;
                    scr.onload = res;
                    scr.onerror = rej;
                    document.body.appendChild(scr);
                });
            }
        }

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

    if (typeof module !== "undefined")
        module.exports = TransAVormerTestHarness;
