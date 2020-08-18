This is a parser for "Xcruciating Markup Language"[1] writen in TypeScript. I followed [Learning Parser Combinators With Rust](https://bodil.lol/parser-combinators) and used it to learn more about how parsers work and to experiment with TypeScript.

The TypeScript type inference isn't as good as Rust's so there are a lot more explicit type declarations in this version. I've added some type aliases to make function invocations less painful to reason about.

Tests are written with [IIFE](https://developer.mozilla.org/en-US/docs/Glossary/IIFE) because I had no interest in setting up all of the required infrastructure to write 'proper' tests.

## set up

* Install [NodeJS](https://nodejs.org/en/download/)
* Run `npm install`

## run

* `npm run compile`
* `npm run parse`

[1] https://bodil.lol/parser-combinators/#the-xcruciating-markup-language