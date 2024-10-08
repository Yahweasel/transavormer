all: dist/transavormer.min.js

dist/transavormer.min.js: src/*.ts node_modules/.bin/rollup
	npm run build

node_modules/.bin/rollup:
	npm install

clean:
	npm run clean
