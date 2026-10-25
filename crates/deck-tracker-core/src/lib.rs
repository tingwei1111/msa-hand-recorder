//! Projects observed deck, hand, public-use, and manual-result data without changing persisted records.

use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::error::Error;
use std::fmt;

const DECK: &str = "msa.deck.";
const MATCH: &str = "msa.match.";
const SESSION: &str = "msa.session.";
/// JavaScript's largest integer whose value can be represented without rounding.
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;
// Wire wrappers add several JSON containers per original JavaScript object.
const MAX_WIRE_JSON_DEPTH: usize = 512;
const MAX_WIRE_JSON_BYTES: usize = 256 * 1024 * 1024;
const PLAYS: [&str; 7] = [
    "deploy-unit",
    "play-command",
    "play-action",
    "play-base",
    "replace-base",
    "pair-pilot",
    "link-pilot",
];

/// Host-defined ECMAScript primitives keep dates, collation, and uppercase conversion browser compatible.
pub trait HostSemantics {
    /// Parses a lossless wire value using the host's `Date.parse` semantics.
    fn date_parse(&self, value_wire_json: &str) -> f64;
    /// Compares arbitrary UTF-16 strings using English host collation.
    fn compare(&self, left: &[u16], right: &[u16]) -> Ordering;
    /// Uppercases arbitrary UTF-16 strings using the host's Unicode rules.
    fn uppercase(&self, value: &[u16]) -> Vec<u16>;
}

/// An invalid or oversized wire envelope, or a projection serialization failure.
#[derive(Debug)]
pub struct ProjectionError {
    kind: ProjectionErrorKind,
}

#[derive(Debug)]
enum ProjectionErrorKind {
    Json(serde_json::Error),
    InputLimit(&'static str),
}

impl fmt::Display for ProjectionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "invalid deck tracker wire data: ")?;
        match &self.kind {
            ProjectionErrorKind::Json(source) => source.fmt(formatter),
            ProjectionErrorKind::InputLimit(message) => formatter.write_str(message),
        }
    }
}

impl Error for ProjectionError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match &self.kind {
            ProjectionErrorKind::Json(source) => Some(source),
            ProjectionErrorKind::InputLimit(_) => None,
        }
    }
}

impl From<serde_json::Error> for ProjectionError {
    fn from(source: serde_json::Error) -> Self {
        Self {
            kind: ProjectionErrorKind::Json(source),
        }
    }
}

/// Scans syntax depth before recursive deserialization, without treating quoted bytes as containers.
fn check_wire_size_and_depth(input: &str) -> Result<(), ProjectionError> {
    if input.len() > MAX_WIRE_JSON_BYTES {
        return Err(ProjectionError {
            kind: ProjectionErrorKind::InputLimit("input exceeds 256 MiB"),
        });
    }
    let mut depth = 0_usize;
    let mut in_string = false;
    let mut escaped = false;
    for byte in input.bytes() {
        if in_string {
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                in_string = false;
            }
        } else {
            match byte {
                b'"' => in_string = true,
                b'[' | b'{' => {
                    depth += 1;
                    if depth > MAX_WIRE_JSON_DEPTH {
                        return Err(ProjectionError {
                            kind: ProjectionErrorKind::InputLimit(
                                "input exceeds 512 JSON container levels",
                            ),
                        });
                    }
                }
                b']' | b'}' => depth = depth.saturating_sub(1),
                _ => {}
            }
        }
    }
    Ok(())
}

/// Lossless transient JavaScript values; this wire representation is never persisted as a record.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "t", content = "v", rename_all = "kebab-case")]
enum Value {
    Object(Vec<(Text, Self)>),
    Array(Vec<Self>),
    String(Text),
    Number(f64),
    Bool(bool),
    Null,
    Undefined,
    Nan,
    PositiveInfinity,
    NegativeInfinity,
}

/// JavaScript strings consist of UTF-16 units, including possible unpaired surrogates.
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(transparent)]
struct Text(Vec<u16>);

impl Text {
    fn from_str(value: &str) -> Self {
        Self(value.encode_utf16().collect())
    }

    fn is(&self, other: &str) -> bool {
        self.0.iter().copied().eq(other.encode_utf16())
    }

    fn starts_with(&self, prefix: &str) -> bool {
        self.0
            .starts_with(&prefix.encode_utf16().collect::<Vec<_>>())
    }

    fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    fn trimmed(&self) -> Self {
        let start = self.0.iter().position(|unit| !ecma_space(*unit));
        let Some(start) = start else {
            return Self::default();
        };
        let end = self
            .0
            .iter()
            .rposition(|unit| !ecma_space(*unit))
            .map_or(start, |i| i + 1);
        Self(self.0[start..end].to_vec())
    }

    fn limited(&self, length: usize) -> Self {
        Self(self.0[..self.0.len().min(length)].to_vec())
    }

    fn with_prefix(&self, prefix: &str) -> Self {
        let mut units = prefix.encode_utf16().collect::<Vec<_>>();
        units.extend_from_slice(&self.0);
        Self(units)
    }
}

fn ecma_space(unit: u16) -> bool {
    matches!(unit, 0x0009..=0x000d | 0x0020 | 0x00a0 | 0x1680 | 0x2000..=0x200a | 0x2028 | 0x2029 | 0x202f | 0x205f | 0x3000 | 0xfeff)
}

static UNDEFINED: Value = Value::Undefined;

impl Value {
    fn get(&self, key: &str) -> &Self {
        self.get_text(&Text::from_str(key))
    }

    fn get_text(&self, key: &Text) -> &Self {
        match self {
            Self::Object(entries) => entries
                .iter()
                .find(|(candidate, _)| candidate == key)
                .map_or(&UNDEFINED, |(_, value)| value),
            _ => &UNDEFINED,
        }
    }

    fn object(&self) -> Option<&[(Text, Self)]> {
        if let Self::Object(entries) = self {
            Some(entries)
        } else {
            None
        }
    }

    fn array(&self) -> Option<&[Self]> {
        if let Self::Array(entries) = self {
            Some(entries)
        } else {
            None
        }
    }

    fn text(&self) -> Text {
        if let Self::String(value) = self {
            value.clone()
        } else {
            Text::default()
        }
    }

    fn name(&self) -> Text {
        self.text().trimmed()
    }

    fn is_text(&self, value: &str) -> bool {
        matches!(self, Self::String(text) if text.is(value))
    }

    fn is_one(&self) -> bool {
        matches!(self, Self::Number(value) if *value == 1.0)
    }

    fn is_true(&self) -> bool {
        matches!(self, Self::Bool(true))
    }

    fn truthy(&self) -> bool {
        match self {
            Self::Object(_) | Self::Array(_) | Self::PositiveInfinity | Self::NegativeInfinity => {
                true
            }
            Self::String(text) => !text.is_empty(),
            Self::Number(value) => *value != 0.0 && !value.is_nan(),
            Self::Bool(value) => *value,
            Self::Null | Self::Undefined | Self::Nan => false,
        }
    }

    fn integer(&self) -> Option<f64> {
        match self {
            Self::Number(value)
                if value.is_finite()
                    && *value >= 0.0
                    && *value <= MAX_SAFE_INTEGER
                    && value.fract() == 0.0 =>
            {
                Some(*value)
            }
            _ => None,
        }
    }
}

fn object(entries: impl IntoIterator<Item = (&'static str, Value)>) -> Value {
    Value::Object(
        entries
            .into_iter()
            .map(|(key, value)| (Text::from_str(key), value))
            .collect(),
    )
}

fn string(value: &str) -> Value {
    Value::String(Text::from_str(value))
}

fn number(value: f64) -> Value {
    if value.is_nan() {
        Value::Nan
    } else if value == f64::INFINITY {
        Value::PositiveInfinity
    } else if value == f64::NEG_INFINITY {
        Value::NegativeInfinity
    } else {
        Value::Number(value)
    }
}

fn valid_id(value: &Value) -> bool {
    let Value::String(text) = value else {
        return false;
    };
    !text.is_empty() && text.0.len() <= 256 && text.0.iter().all(|unit| matches!(*unit, 0x0041..=0x005a | 0x0061..=0x007a | 0x0030..=0x0039 | 0x005f | 0x002e | 0x003a | 0x002d))
}

fn digits(units: &[u16]) -> bool {
    units.iter().all(|unit| (0x0030..=0x0039).contains(unit))
}

fn valid_code(text: &Text) -> bool {
    let Some(dash) = text.0.iter().position(|unit| *unit == 0x002d) else {
        return false;
    };
    if text.0.len() != dash + 4 || !digits(&text.0[dash + 1..]) {
        return false;
    }
    let prefix = Text(text.0[..dash].to_vec());
    if ["EXB", "EXR", "PR", "P", "R", "T"]
        .iter()
        .any(|value| prefix.is(value))
    {
        return true;
    }
    ["GD", "ST", "EB", "SC", "SLB"].iter().any(|family| {
        prefix.starts_with(family)
            && (2..=3).contains(&(dash - family.len()))
            && digits(&text.0[family.len()..dash])
    })
}

fn normalized_code(value: &Value, host: &impl HostSemantics) -> Option<Text> {
    let candidate = Text(host.uppercase(&value.name().0));
    valid_code(&candidate).then_some(candidate)
}

fn parsed_time(value: &Value, host: &impl HostSemantics) -> f64 {
    // Every Value variant has a finite JSON wire serialization, including NaN.
    let encoded =
        serde_json::to_string(value).expect("wire values always serialize as finite tagged JSON");
    let timestamp = host.date_parse(&encoded);
    if timestamp.is_finite() {
        timestamp
    } else {
        f64::NEG_INFINITY
    }
}

fn compare(left: &Text, right: &Text, host: &impl HostSemantics) -> Ordering {
    host.compare(&left.0, &right.0)
}

#[derive(Debug)]
struct CardRows {
    counts: HashMap<Text, f64>,
    names: HashMap<Text, Text>,
    total: f64,
}

fn card_rows(value: &Value) -> Option<CardRows> {
    let rows = value.array()?;
    if rows.len() > 200 {
        return None;
    }
    let mut counts = HashMap::new();
    let mut names = HashMap::new();
    for row in rows {
        let code = row.get("cardCode").text();
        let amount = row.get("count").integer()?;
        if row.object().is_none() || !valid_code(&code) || !(1.0..=100.0).contains(&amount) {
            return None;
        }
        *counts.entry(code.clone()).or_insert(0.0) += amount;
        let name = row.get("name").name();
        if !name.is_empty() {
            names.entry(code).or_insert_with(|| name.limited(300));
        }
    }
    let total = counts.values().sum();
    Some(CardRows {
        counts,
        names,
        total,
    })
}

#[derive(Debug)]
struct Deck<'a> {
    record: &'a Value,
    main: CardRows,
}

fn deck_record<'a>(value: &'a Value, expected_id: &Text) -> Option<Deck<'a>> {
    if value.object().is_none()
        || !value.get("schemaVersion").is_one()
        || !valid_id(value.get("id"))
        || value.get("id").text() != *expected_id
        || !valid_id(value.get("deckId"))
        || value.get("name").name().is_empty()
        || value.get("name").text().0.len() > 120
    {
        return None;
    }
    let main = card_rows(value.get("main"))?;
    card_rows(value.get("resources"))?;
    card_rows(value.get("tokens"))?;
    if main.total != 50.0
        || main.counts.iter().any(|(code, count)| {
            *count > 4.0
                || ["R-", "EXR-", "EXB-", "T-"]
                    .iter()
                    .any(|prefix| code.starts_with(prefix))
        })
    {
        return None;
    }
    Some(Deck {
        record: value,
        main,
    })
}

fn valid_match(key: &Text, value: &Value) -> bool {
    key.starts_with(MATCH)
        && value.object().is_some()
        && value.get("schemaVersion").is_one()
        && valid_id(value.get("id"))
        && *key == value.get("id").text().with_prefix(MATCH)
        && valid_id(value.get("gameId"))
        && value.get("gameId").text().0.len() <= 128
        && !value.get("playerName").name().is_empty()
        && value.get("playerName").text().0.len() <= 200
        && value.get("source").is_text("manual")
        && value.get("identityConfirmed").is_true()
}

fn match_records<'a>(
    values: &'a Value,
    player_name: &Text,
    host: &impl HostSemantics,
) -> HashMap<Text, &'a Value> {
    let mut selected: HashMap<Text, &Value> = HashMap::new();
    if player_name.is_empty() {
        return selected;
    }
    for (key, value) in values.object().unwrap_or_default() {
        if !valid_match(key, value) || value.get("playerName").name() != *player_name {
            continue;
        }
        let game = value.get("gameId").text();
        let replace = selected.get(&game).is_none_or(|previous| {
            let now = parsed_time(value.get("updatedAt"), host);
            let prior = parsed_time(previous.get("updatedAt"), host);
            now > prior || (now == prior && value.get("id").text().0 > previous.get("id").text().0)
        });
        if replace {
            selected.insert(game, value);
        }
    }
    selected
}

fn statistics(matches: &HashMap<Text, &Value>, deck_id: &Text) -> Value {
    let (mut confirmed, mut wins, mut losses, mut draws, mut concedes) = (0.0, 0.0, 0.0, 0.0, 0.0);
    for record in matches.values() {
        if record.get("deckVersionId").text() != *deck_id
            || !matches!(record.get("deckVersionId"), Value::String(_))
            || !record.get("resultConfirmed").is_true()
        {
            continue;
        }
        let result = record.get("result");
        if result.is_text("win") {
            wins += 1.0;
        } else if result.is_text("loss") {
            losses += 1.0;
        } else if result.is_text("draw") {
            draws += 1.0;
        } else if result.is_text("concede") {
            concedes += 1.0;
        } else {
            continue;
        }
        confirmed += 1.0;
    }
    object([
        ("confirmed", number(confirmed)),
        ("wins", number(wins)),
        ("losses", number(losses)),
        ("draws", number(draws)),
        ("concedes", number(concedes)),
        (
            "winRate",
            if confirmed > 0.0 {
                number(wins / confirmed)
            } else {
                Value::Null
            },
        ),
    ])
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Side {
    Own,
    Opponent,
    Unknown,
}

impl Side {
    fn label(self) -> &'static str {
        match self {
            Self::Own => "own",
            Self::Opponent => "opponent",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Debug)]
struct PublicRow {
    code: Option<Text>,
    name: Text,
    count: f64,
    actor: Text,
    side: Option<Side>,
}

impl PublicRow {
    fn wire(&self) -> Value {
        let mut fields = vec![
            (
                "cardCode",
                self.code
                    .as_ref()
                    .map_or(Value::Null, |code| Value::String(code.clone())),
            ),
            ("name", Value::String(self.name.clone())),
            ("count", number(self.count)),
            ("actor", Value::String(self.actor.clone())),
        ];
        if let Some(side) = self.side {
            fields.push(("side", string(side.label())));
        }
        object(fields)
    }
}

#[derive(Debug, Default)]
struct PublicGroup {
    rows: Vec<PublicRow>,
    indices: HashMap<(Text, Option<Text>, Text), usize>,
}

impl PublicGroup {
    fn add(&mut self, code: Option<Text>, name: Text, actor: Text, side: Option<Side>) {
        let key = (
            actor.clone(),
            code.clone(),
            if code.is_some() {
                Text::default()
            } else {
                name.clone()
            },
        );
        if let Some(index) = self.indices.get(&key) {
            self.rows[*index].count += 1.0;
            if self.rows[*index].name.is_empty() && !name.is_empty() {
                self.rows[*index].name = name;
            }
        } else {
            self.indices.insert(key, self.rows.len());
            self.rows.push(PublicRow {
                code,
                name,
                count: 1.0,
                actor,
                side,
            });
        }
    }

    fn sort(&mut self, host: &impl HostSemantics) {
        let last = Text(vec![0xffff]);
        self.rows.sort_by(|left, right| {
            compare(
                left.code.as_ref().unwrap_or(&last),
                right.code.as_ref().unwrap_or(&last),
                host,
            )
            .then_with(|| compare(&left.actor, &right.actor, host))
            .then_with(|| compare(&left.name, &right.name, host))
        });
    }
}

#[derive(Debug, Default)]
struct PublicCards {
    own: PublicGroup,
    opponent: PublicGroup,
    unknown: PublicGroup,
    tokens: PublicGroup,
    names: HashMap<Text, Text>,
    unsupported: usize,
}

impl PublicCards {
    fn wire(&self) -> Value {
        object([
            (
                "own",
                Value::Array(self.own.rows.iter().map(PublicRow::wire).collect()),
            ),
            (
                "opponent",
                Value::Array(self.opponent.rows.iter().map(PublicRow::wire).collect()),
            ),
            (
                "unknown",
                Value::Array(self.unknown.rows.iter().map(PublicRow::wire).collect()),
            ),
            (
                "tokens",
                Value::Array(self.tokens.rows.iter().map(PublicRow::wire).collect()),
            ),
        ])
    }
}

fn public_cards(
    events: &Value,
    player_name: &Text,
    players: &Value,
    host: &impl HostSemantics,
) -> PublicCards {
    let opponents = players
        .array()
        .unwrap_or_default()
        .iter()
        .map(Value::name)
        .filter(|name| !name.is_empty() && name != player_name)
        .collect::<HashSet<_>>();
    let mut result = PublicCards::default();
    for event in events.array().unwrap_or_default() {
        if event.object().is_none() {
            continue;
        }
        let primary = event.get("primaryCard");
        let code = normalized_code(primary.get("cardCode"), host);
        let name = primary.get("name").name().limited(300);
        let actor = event.get("actor").name();
        let side = if player_name.is_empty() || actor.is_empty() {
            Side::Unknown
        } else if actor == *player_name {
            Side::Own
        } else if opponents.contains(&actor) {
            Side::Opponent
        } else {
            Side::Unknown
        };
        let token = event.get("action").is_text("deploy-token")
            || event.get("sourceZone").is_text("generated")
            || (event.get("isPlay").is_true()
                && code.as_ref().is_some_and(|code| code.starts_with("T-")));
        let group = if token {
            Some((&mut result.tokens, Some(side)))
        } else if !event.get("isPlay").is_true() {
            None
        } else if !PLAYS
            .iter()
            .any(|action| event.get("action").is_text(action))
        {
            result.unsupported += 1;
            None
        } else {
            Some((
                match if code.is_some() { side } else { Side::Unknown } {
                    Side::Own => &mut result.own,
                    Side::Opponent => &mut result.opponent,
                    Side::Unknown => &mut result.unknown,
                },
                None,
            ))
        };
        if let Some((group, token_side)) = group {
            if let Some(code) = &code {
                if !name.is_empty() {
                    result
                        .names
                        .entry(code.clone())
                        .or_insert_with(|| name.clone());
                }
            }
            group.add(code, name, actor, token_side);
        }
    }
    result.own.sort(host);
    result.opponent.sort(host);
    result.unknown.sort(host);
    result.tokens.sort(host);
    result
}

#[derive(Debug, Clone, Copy)]
enum HandKind {
    Exact,
    AtLeast,
    Unknown,
}

#[derive(Debug)]
struct HandEvidence {
    counts: HashMap<Text, f64>,
    kind: HandKind,
    note: &'static str,
}

impl HandEvidence {
    fn absent(note: &'static str) -> Self {
        Self {
            counts: HashMap::new(),
            kind: HandKind::Unknown,
            note,
        }
    }
}

fn hand_evidence(
    hand: &Value,
    player_name: &Text,
    current_id: &Text,
    source: Option<&Value>,
    host: &impl HostSemantics,
) -> HandEvidence {
    let snapshot = hand.get("latestSnapshot");
    let valid_source = source.is_some_and(|source| source.get("snapshots").array().unwrap_or_default().iter().any(|item| matches!((item.get("id"), snapshot.get("id")), (Value::String(left), Value::String(right)) if left == right)));
    if player_name.is_empty()
        || !valid_source
        || snapshot.object().is_none()
        || snapshot.get("id").name().is_empty()
        || (snapshot.get("sourceSessionId").truthy()
            && snapshot.get("sourceSessionId").text() != *current_id)
        || (hand.get("sessionId").truthy() && hand.get("sessionId").text() != *current_id)
        || hand.get("handCards").array().is_none()
    {
        return HandEvidence::absent("尚無本段來源相符的已存本人手牌，未推定各卡為 0。");
    }
    if !["complete", "partial"]
        .iter()
        .any(|quality| hand.get("quality").is_text(quality))
    {
        return HandEvidence::absent("最近已存手牌無法完整辨識，各卡數量維持未知。");
    }
    let mut counts = HashMap::new();
    let mut total = 0.0;
    for row in hand.get("handCards").array().unwrap_or_default() {
        let Some(code) = normalized_code(row.get("cardCode"), host) else {
            return HandEvidence::absent("最近手牌欄位未通過格式核對，各卡數量維持未知。");
        };
        let Some(amount) = row.get("count").integer().filter(|amount| *amount >= 1.0) else {
            return HandEvidence::absent("最近手牌欄位未通過格式核對，各卡數量維持未知。");
        };
        *counts.entry(code).or_insert(0.0) += amount;
    }
    // Accumulate in source order, matching JavaScript Map insertion order.
    let mut seen = HashSet::new();
    for row in hand.get("handCards").array().unwrap_or_default() {
        if let Some(code) = normalized_code(row.get("cardCode"), host) {
            if seen.insert(code.clone()) {
                total += counts.get(&code).copied().unwrap_or(0.0);
            }
        }
    }
    let exact = hand.get("quality").is_text("complete")
        && snapshot.get("quality").is_text("complete")
        && matches!(snapshot.get("unknownCount"), Value::Number(value) if *value == 0.0)
        && snapshot.get("expectedCount").integer() == Some(total);
    HandEvidence {
        counts,
        kind: if exact {
            HandKind::Exact
        } else {
            HandKind::AtLeast
        },
        note: if exact {
            "手牌張數依最近已存完整觀察；未涵蓋所有瞬間。"
        } else {
            "部分辨識只列已辨識張數下限；未辨識到的卡維持未知。"
        },
    }
}

fn set_field(value: &mut Value, key: &str, replacement: Value) {
    if let Value::Object(entries) = value {
        if let Some((_, value)) = entries.iter_mut().find(|(candidate, _)| candidate.is(key)) {
            *value = replacement;
        }
    }
}

fn project(input: &Value, host: &impl HostSemantics) -> Value {
    let values = input.get("values");
    let context = input.get("context");
    let game_id = context.get("gameId").text();
    let player_name = context.get("playerName").name();
    let run_id = context.get("runId").text();
    let current_id = if !game_id.is_empty() && !run_id.is_empty() {
        let mut result = game_id.0.clone();
        result.push(0x002e);
        result.extend_from_slice(&run_id.0);
        Text(result)
    } else {
        Text::default()
    };
    let mut available = Vec::new();
    for (key, value) in values.object().unwrap_or_default() {
        if key.starts_with(DECK) {
            if let Some(deck) = deck_record(value, &Text(key.0[DECK.len()..].to_vec())) {
                available.push(deck);
            }
        }
    }
    available.sort_by(|left, right| {
        let delta = parsed_time(right.record.get("createdAt"), host)
            - parsed_time(left.record.get("createdAt"), host);
        let time_order = if delta.is_nan() || delta == 0.0 {
            Ordering::Equal
        } else if delta < 0.0 {
            Ordering::Less
        } else {
            Ordering::Greater
        };
        time_order
            .then_with(|| {
                compare(
                    &left.record.get("name").text(),
                    &right.record.get("name").text(),
                    host,
                )
            })
            .then_with(|| {
                compare(
                    &left.record.get("id").text(),
                    &right.record.get("id").text(),
                    host,
                )
            })
    });
    let current = values.get_text(&current_id.with_prefix(SESSION));
    let can_bind = !player_name.is_empty()
        && !current_id.is_empty()
        && current.object().is_some()
        && current.get("schemaVersion").is_one()
        && current.get("id").text() == current_id
        && current.get("gameId").text() == game_id
        && current.get("playerName").name() == player_name
        && current
            .get("snapshots")
            .array()
            .is_some_and(|snapshots| !snapshots.is_empty());
    let public_view = public_cards(
        input.get("events"),
        &player_name,
        input.get("players"),
        host,
    );
    let coverage = input.get("coverage");
    let coverage_note =
        if coverage.get("hasGaps").truthy() || coverage.get("unmergedCaptureCount").truthy() {
            "公開 Log 有待確認缺口。"
        } else if coverage.get("publicLogComplete").truthy() {
            "公開 Log 已見起尾。"
        } else {
            "公開 Log 尚未確認整場完整。"
        };
    let hand = hand_evidence(
        input.get("handModel"),
        &player_name,
        &current_id,
        can_bind.then_some(current),
        host,
    );
    let mut warnings = Vec::new();
    if public_view.unsupported > 0 {
        warnings.push(string(&format!(
            "有 {} 筆未支援的公開動作格式，未計入使用次數。",
            public_view.unsupported
        )));
    }
    let mut result = object([
        (
            "state",
            string(if player_name.is_empty() {
                "identity-unknown"
            } else {
                "unbound"
            }),
        ),
        ("gameId", Value::String(game_id.clone())),
        ("playerName", Value::String(player_name.clone())),
        ("contextKey", Value::String(current_id.clone())),
        (
            "sessionId",
            if can_bind {
                Value::String(current_id.clone())
            } else {
                Value::Null
            },
        ),
        ("canBind", Value::Bool(can_bind)),
        (
            "availableDecks",
            Value::Array(
                available
                    .iter()
                    .map(|deck| {
                        object([
                            ("id", deck.record.get("id").clone()),
                            ("name", deck.record.get("name").clone()),
                        ])
                    })
                    .collect(),
            ),
        ),
        ("deck", Value::Null),
        ("rows", Value::Array(Vec::new())),
        ("publicCards", public_view.wire()),
        ("warnings", Value::Array(warnings.clone())),
        ("handNote", string(hand.note)),
        (
            "publicNote",
            string(&format!(
                "只計已收錄公開使用次數；同卡再次使用會重複計數，不推算剩餘牌庫。{coverage_note}"
            )),
        ),
        (
            "stateDetail",
            string(if player_name.is_empty() {
                "本人身分尚未確認，不借用其他玩家牌組或手牌。"
            } else {
                "本場尚未綁定牌組，請選擇並確認使用的版本。"
            }),
        ),
        ("stats", statistics(&HashMap::new(), &Text::default())),
        (
            "unsupportedPublicCount",
            number(public_view.unsupported as f64),
        ),
    ]);
    let matches = match_records(values, &player_name, host);
    let Some(binding) = matches
        .get(&game_id)
        .copied()
        .filter(|binding| !player_name.is_empty() && binding.get("deckVersionId").truthy())
    else {
        return result;
    };
    let deck_id = binding.get("deckVersionId").text();
    let frozen = binding.get("frozenDeckVersion");
    let bound = if !matches!(frozen, Value::Null | Value::Undefined) {
        let Some(bound) = deck_record(frozen, &deck_id) else {
            set_field(&mut result, "state", string("invalid"));
            set_field(
                &mut result,
                "stateDetail",
                string("本場凍結牌組版本格式或 ID 不符，未改用其他版本。"),
            );
            return result;
        };
        bound
    } else {
        let Some(bound) = deck_record(values.get_text(&deck_id.with_prefix(DECK)), &deck_id) else {
            set_field(&mut result, "state", string("invalid"));
            set_field(
                &mut result,
                "stateDetail",
                string("找不到本場綁定且格式有效的牌組版本，請重新核對綁定。"),
            );
            return result;
        };
        warnings.push(string(
            "此舊記錄缺少凍結牌表，目前使用同 ID 的已存版本，請核對內容。",
        ));
        bound
    };
    set_field(&mut result, "state", string("bound"));
    set_field(
        &mut result,
        "stateDetail",
        string("使用本場人工確認的牌組版本；主牌格式通過不代表賽制合法性已驗證。"),
    );
    set_field(
        &mut result,
        "deck",
        object([
            ("id", Value::String(deck_id.clone())),
            ("name", bound.record.get("name").clone()),
            ("mainCount", number(bound.main.total)),
        ]),
    );
    set_field(&mut result, "stats", statistics(&matches, &deck_id));
    let own_uses = public_view
        .own
        .rows
        .iter()
        .filter_map(|row| row.code.as_ref().map(|code| (code.clone(), row.count)))
        .collect::<HashMap<_, _>>();
    let mut codes = bound
        .main
        .counts
        .keys()
        .chain(hand.counts.keys())
        .chain(own_uses.keys())
        .cloned()
        .collect::<HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    codes.sort_by(|left, right| compare(left, right, host));
    let mut outside_count = 0;
    let mut excessive_hand = false;
    let rows = codes
        .iter()
        .map(|code| {
            let deck_count = bound.main.counts.get(code).copied().unwrap_or(0.0);
            let (hand_count, hand_kind) = match hand.kind {
                HandKind::Exact => (Some(hand.counts.get(code).copied().unwrap_or(0.0)), "exact"),
                HandKind::AtLeast if hand.counts.contains_key(code) => {
                    (hand.counts.get(code).copied(), "at-least")
                }
                _ => (None, "unknown"),
            };
            if deck_count == 0.0 {
                outside_count += 1;
            }
            if deck_count != 0.0 && hand_count.is_some_and(|count| count > deck_count) {
                excessive_hand = true;
            }
            object([
                ("cardCode", Value::String(code.clone())),
                (
                    "name",
                    Value::String(
                        bound
                            .main
                            .names
                            .get(code)
                            .or_else(|| public_view.names.get(code))
                            .cloned()
                            .unwrap_or_default(),
                    ),
                ),
                ("deckCount", number(deck_count)),
                ("handCount", hand_count.map_or(Value::Null, number)),
                ("handCountKind", string(hand_kind)),
                (
                    "publicUseCount",
                    number(own_uses.get(code).copied().unwrap_or(0.0)),
                ),
                ("outsideDeck", Value::Bool(deck_count == 0.0)),
            ])
        })
        .collect();
    if outside_count > 0 {
        warnings.push(string(&format!("本人已存觀察或公開使用含 {outside_count} 種牌表外卡號，請核對牌組綁定與記錄；未改寫牌表。")));
    }
    if excessive_hand {
        warnings.push(string(
            "已辨識手牌張數超過所綁牌表的同卡數量，請核對版本與辨識結果。",
        ));
    }
    set_field(&mut result, "rows", Value::Array(rows));
    set_field(&mut result, "warnings", Value::Array(warnings));
    result
}

/// Projects a transient wire input using explicitly supplied browser primitive semantics.
///
/// The caller supplies only dates, collation, and Unicode uppercase behavior; all
/// validation, hand provenance, aggregation, binding, and statistics run in Rust.
/// Persisted session, deck, match, note, and backup structures are never mutated.
///
/// # Errors
/// Returns an error if the input is not a valid lossless wire envelope, exceeds
/// 256 MiB, or contains more than 512 nested JSON containers.
pub fn project_with_host(
    input_wire_json: &str,
    host: &impl HostSemantics,
) -> Result<String, ProjectionError> {
    check_wire_size_and_depth(input_wire_json)?;
    let mut deserializer = serde_json::Deserializer::from_str(input_wire_json);
    deserializer.disable_recursion_limit();
    let input = Value::deserialize(&mut deserializer)?;
    deserializer.end()?;
    Ok(serde_json::to_string(&project(&input, host))?)
}

#[cfg(target_arch = "wasm32")]
mod wasm;
