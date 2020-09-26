type Err = {
    success: false
    error: string
}

type Result<T> = {
    success: true
    nextInput: string
    result: T
}

type ParseResult<T> = Result<T> | Err

type Parser<T> = (input: string) => ParseResult<T>

type Mapper<A, B> = (input: A) => B

// Some type aliases to make function calls a bit clearer
type StringTuple = [string, string]
type StringParser = Parser<string>
type ElementParser = Parser<XElement>

class XElement {
    name: string
    attributes: StringTuple[]
    children: XElement[]
    constructor(name: string, attributes: StringTuple[]) {
        this.name = name
        this.attributes = attributes
        this.children = []
    }
}

function map<P extends Parser<A>, F extends Mapper<A, B>, A, B>(parser: P, map_fn: F): Parser<B> {
    return function (input: string) {
        let res = parser(input)
        if (!res.success) {
            return { success: false, error: res.error }
        }

        return { nextInput: res.nextInput, result: map_fn(res.result), success: true }
    }
}

function pair<P1 extends Parser<R1>, P2 extends Parser<R2>, R1, R2>(parser1: P1, parser2: P2): Parser<[R1, R2]> {
    return function (input: string) {
        let result1 = parser1(input)
        if (!result1.success) {
            return { success: false, error: result1.error }
        }

        let result2 = parser2(result1.nextInput)
        if (!result2.success) {
            return { success: false, error: result2.error }
        }

        return { nextInput: result2.nextInput, result: [result1.result, result2.result], success: true }
    }
}

function left<P1 extends Parser<A>, P2 extends Parser<B>, A, B>(parser1: P1, parser2: P2): Parser<A> {
    let f = (r: [A, B]) => r[0]
    let parser = pair<P1, P2, A, B>(parser1, parser2)
    return map<typeof parser, typeof f, [A, B], A>(parser, f)
}

function right<P1 extends Parser<A>, P2 extends Parser<B>, A, B>(parser1: P1, parser2: P2): Parser<B> {
    let f = (r: [A, B]) => r[1]
    let parser = pair<P1, P2, A, B>(parser1, parser2)
    return map<typeof parser, typeof f, [A, B], B>(parser, f)
}

function oneOrMore<P extends Parser<A>, A>(parser: P): Parser<A[]> {
    return function (input: string) {
        const result = parser(input)
        if (!result.success) {
            return { success: false, error: `'${input}' not matched` }
        }
        let results: A[] = []
        let nextInput = result.nextInput
        results.push(result.result)

        while (true) {
            const result = parser(nextInput)
            if (!result.success) {
                break
            }
            nextInput = result.nextInput
            input = nextInput
            results.push(result.result)
        }

        return { nextInput: nextInput, result: results, success: true }
    }
}

function zeroOrMore<P extends Parser<A>, A>(parser: P): Parser<A[]> {
    return function (input: string) {
        let results: A[] = []
        let nextInput = input

        while (true) {
            const result = parser(nextInput)
            if (!result.success) {
                break
            }
            nextInput = result.nextInput
            input = nextInput
            results.push(result.result)
        }

        return { nextInput: nextInput, result: results, success: true }
    }
}

function pred<P extends Parser<A>, A>(parser: P, pred: (input: A) => boolean): Parser<A> {
    return function (input: string) {
        const result = parser(input)
        if (!result.success) {
            return { success: false, error: result.error }
        }
        if (pred(result.result)) {
            return { nextInput: result.nextInput, result: result.result, success: true }
        }
        return { success: false, error: input }
    }
}

function anyChar(input: string): ParseResult<string> {
    if (input.length > 0) {
        return { nextInput: input.substring(1), result: input[0], success: true }
    }
    return { success: false, error: input }
}

function quotedString(): StringParser {
    const p = pred(anyChar, (x: string) => x != `"`)
    const parser = right<StringParser, Parser<string[]>, string, string[]>(
        matchLiteral(`"`),
        left(
            zeroOrMore<typeof p, string>(p),
            matchLiteral(`"`)
        )
    )
    const mapper = (x: string[]) => x.join("")
    return map<Parser<string[]>, typeof mapper, string[], string>(
        parser,
        mapper
    )
}

function whitespaceChar(): StringParser {
    return pred(anyChar, input => input[0] == ' ' || input[0] == '\n')
}

function space0(): Parser<string[]> {
    return zeroOrMore(whitespaceChar())
}

function space1(): Parser<string[]> {
    return oneOrMore(whitespaceChar())
}

function attributePair(): Parser<StringTuple> {
    return pair(identifier, right<StringParser, StringParser, string, string>(matchLiteral("="), quotedString()))
}

function attributes(): Parser<StringTuple[]> {
    return zeroOrMore(right<Parser<string[]>, Parser<[string, string]>, string[], [string, string]>(space1(), attributePair()))
}

function elementStart(): Parser<[string, StringTuple[]]> {
    const attrs = attributes()
    return right(matchLiteral("<"), pair<typeof identifier, typeof attrs, string, StringTuple[]>(identifier, attrs))
}

function openElement(): ElementParser {
    const f = (input: [string, StringTuple[]]): XElement => {
        const [name, [...rest]] = input
        return new XElement(name, rest)
    }
    const l = left<Parser<[string, StringTuple[]]>, StringParser, [string, StringTuple[]], string>(elementStart(), matchLiteral(">"))
    return map<typeof l, typeof f, [string, StringTuple[]], XElement>(
        l,
        f
    )
}

function singleElement(): ElementParser {
    const f = (input: [string, StringTuple[]]): XElement => {
        const [name, [...rest]] = input
        return new XElement(name, rest)
    }
    const l = left<Parser<[string, StringTuple[]]>, StringParser, [string, StringTuple[]], string>(elementStart(), matchLiteral("/>"))
    return map<typeof l, typeof f, [string, StringTuple[]], XElement>(
        l,
        f
    )
}

function closeElement(expectedName: string): StringParser {
    const m = matchLiteral("</")
    const l = left<typeof identifier, typeof m, string, string>(identifier, matchLiteral(">"))
    const p = pred<StringParser, string>(right(m, l), x => x == expectedName)
    return p
}

function parentElement(): ElementParser {
    const open = openElement()

    return andThen<typeof open, ElementParser, (input: XElement) => ElementParser, XElement, XElement>(open,
        el => {
            const close = closeElement(el.name)
            const elements = zeroOrMore<ElementParser, XElement>(element())
            const l = left<typeof elements, typeof close, XElement[], string>(elements, close)
            return map<typeof l, (x: XElement[]) => XElement, XElement[], XElement>(l, (x: XElement[]) => {
                el.children = x
                return el
            })
        })
}

function andThen<P extends Parser<A>, NextP extends Parser<B>, F extends (input: A) => NextP, A, B>(parser: P, f: F): Parser<B> {
    return function (input: string) {
        const result1 = parser(input)
        if (!result1.success) {
            return result1
        }
        const next = f(result1.result)
        return next(result1.nextInput)
    }
}



function whitespaceWrap<P extends Parser<A>, A>(parser: P): Parser<A> {
    const l = left<Parser<A>, Parser<string[]>, A, string[]>(parser, space0())
    return right(space0(), l)
}

function element(): ElementParser {
    return whitespaceWrap<ElementParser, XElement>(either(singleElement(), parentElement()))
}

function either<P1 extends Parser<A>, P2 extends Parser<A>, A>(parser1: P1, parser2: P2): Parser<A> {
    return function (input: string) {
        const result1 = parser1(input)
        if (!result1.success) {
            return parser2(input)
        }
        return result1
    }
}

function matchLiteral<T extends string>(expected: string): (input: T) => ParseResult<string> {
    return function (s: T): ParseResult<string> {
        if (s.startsWith(expected)) {
            return { nextInput: s.substring(expected.length, s.length), result: "", success: true }
        }
        return { success: false, error: "no match for: '" + expected + "' in: " + s }
    }
}

function identifier(input: string): ParseResult<string> {
    let matched: string = "";

    for (const char of input) {
        if (isAlpha(char) || char == "-") {
            matched = matched + char;
        } else {
            break;
        }
    }

    return { nextInput: input.substring(input.length, matched.length), result: matched, success: true }
}

function isAlpha(s: string) {
    let code, i, len;

    for (i = 0, len = s.length; i < len; i++) {
        code = s.charCodeAt(i);
        if (// !(code > 47 && code < 58) && // numeric (0-9)
            !(code > 64 && code < 91) && // upper alpha (A-Z)
            !(code > 96 && code < 123)) { // lower alpha (a-z)
            return false;
        }
    }
    return true;
};

// tests

(function TestParentElement() {
    const result = element()(
        `
        <top label="Top">
          <semi-bottom label="Bottom"/>
          <middle>
            <bottom label="Another bottom"/>
          </middle>
        </top>
        `
    )
    console.log(JSON.stringify(result, null, 2))
}());

(function TestSingleElement() {
    const result = singleElement()(`<div class="float"/>`)

    const element = (result as Result<XElement>).result
    if (element?.name == "div") {
        console.log("OK")
    } else {
        console.log(JSON.stringify(result, null, 2))
        console.log(result)
    }

    if (element?.attributes[0][0] == "class" && element.attributes[0][1] == "float") {
        console.log("OK")
    } else {
        console.log(JSON.stringify(result, null, 2))
        console.log(result)
    }
}());

(function TestAttriburePair() {
    const result = attributePair()(`one="1"`) as Result<StringTuple>

    if (result.result[0] == "one" && result.result[1] == '1') {
        console.log("OK")
    } else {
        console.log(result)
    }
}());

(function TestAttributeParser() {
    const result = attributes()(` one="1" two="2"`) as Result<StringTuple[]>
    const [first, second] = result.result

    if (result.result[0][0] == "one" && result.result[0][1] == "1") {
        console.log("OK")
    } else {
        console.log(result)
    }
}());

(function TestedQuotedString() {
    const result = quotedString()(`"hello"`) as Result<string>

    if (result.result == "hello") {
        console.log("OK")
    } else {
        console.log(result)
    }
}());

(function TestPred() {
    const predParser = pred<StringParser, string>(anyChar, x => x == 'o')
    const result = predParser("omg") as Result<string>

    if (result.result === 'o' && result.nextInput == 'mg') {
        console.log("OK")
    } else {
        console.log(result)
    }

    const resultBorked = predParser("lol") as Err

    if (resultBorked.error === 'lol') {
        console.log("OK")
    } else {
        console.log(resultBorked)
    }
}());

(function TestOneOrMore() {
    const literal = matchLiteral("ha")
    const parser = oneOrMore<typeof literal, string>(literal)
    const result = parser("hahaha") as Result<string[]>

    if (result.result.toString() === ['', '', ''].toString()) {
        console.log("OK")
    } else {
        console.log(result.result)
    }

    const resultBorked = parser("ahaha") as Err
    if (resultBorked.error === `'ahaha' not matched`) {
        console.log("OK")
    } else {
        console.log(resultBorked.error)
    }
}());

(function TestZeroOrMore() {
    const literal = matchLiteral("ha")
    const parser = zeroOrMore<typeof literal, string>(literal)
    const result = parser("hahaha") as Result<string[]>

    if (result.result.toString() === ['', '', ''].toString()) {
        console.log("OK")
    } else {
        console.log(result.result)
    }

    const resultBorked = parser("ahaha") as Result<string[]>
    if (resultBorked.result.toString() === [].toString()) {
        console.log("OK")
    } else {
        console.log(resultBorked)
    }
}());

(function TestLeft() {
    let p1 = identifier
    let p2 = matchLiteral(" literal")
    let result = left<typeof p1, typeof p2, string, string>(p1, p2)("identifier literal") as Result<string>

    var mappedIdent = "identifier"
    var nextInput = ""
    if (result.result == mappedIdent && result.nextInput == nextInput) {
        console.log("OK")
    } else {
        console.log(result)
    }
}());

(function TestRight() {
    let p1 = matchLiteral("<")
    let p2 = identifier
    let result = right<typeof p1, typeof p2, string, string>(p1, p2)("<identifier/>") as Result<string>

    var mappedIdent = "identifier"
    var nextInput = "/>"
    if (result.result == mappedIdent && result.nextInput == nextInput) {
        console.log("OK")
    } else {
        console.log(result)
    }
}());

(function TestPair2() {
    let pairer = pair<StringParser, StringParser, string, string>(matchLiteral<string>("<"), identifier)
    let result = pairer("<my-first-element/>") as Result<[string, string]>

    var mappedIdent = "my-first-element"
    var nextInput = "/>"
    if (result?.result[1] == mappedIdent && result.nextInput == nextInput) {
        console.log("OK")
    } else {
        console.log(result)
    }
}());

(function TestPair() {
    let pairer = pair<StringParser, StringParser, string, string>(identifier, matchLiteral<string>(" ext"))
    let result = pairer("identifier extra") as Result<[string, string]>

    var mappedIdent = "identifier"
    var nextInput = "ra"
    if (result?.result[0] == mappedIdent && result.nextInput == nextInput) {
        console.log("OK")
    } else {
        console.log(result)
    }
}());

(function TestMap() {
    let mapper = map(identifier, (input) => input + " map stuff")
    let result = mapper("ident-ifier extra") as Result<string>

    var mappedIdent = "ident-ifier map stuff"
    var nextInput = " extra"
    if (result?.result == mappedIdent && result.nextInput == nextInput) {
        console.log("OK")
    } else {
        console.log(result)
    }
}());

(function TestIdentifier() {
    var result = identifier("abc-def asdf") as Result<string>

    var ident = "abc-def"
    var next = " asdf"
    if (result?.result == ident && result.nextInput == next) {
        console.log("OK")
    } else {
        console.log(result)
    }
}());

(function TestMatchLiteral() {
    let parser = matchLiteral("Hello Joe")

    let result = parser("Hello Joe") as Result<string>
    let expected = { nextInput: "", result: "" }
    if (result?.nextInput == expected.nextInput) {
        console.log("OK")
    } else {
        console.log(result)
    }

    result = parser("Hello Joe Hello Robert") as Result<string>
    expected = { nextInput: " Hello Robert", result: "" }
    if (result?.nextInput == expected.nextInput) {
        console.log("OK")
    } else {
        console.log(result)
    }

    var err = parser("Hello Mike") as Err
    var expectedErr = "no match for: 'Hello Joe' in: Hello Mike"
    if (err?.error == expectedErr) {
        console.log("OK")
    } else {
        console.log(err)
    }
}());
// console.log(matchLiteral("abc")("acbcdef"))