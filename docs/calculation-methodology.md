# Extraction Comparator Calculation Methodology

This document explains how the system compares manual extractions with LLM output and how it calculates the displayed metrics.

## 1. Input Data

The system compares two sets of relationship triples.

### Manual Extraction

Manual rows are expected to contain a relationship representation in this shape:

```text
source -> [relation] -> target
```

In the application UI this may display with arrows:

```text
source → [relation] → target
```

Example:

```text
Bangladesh → [has] → agro-based economy
```

If the manual file is a CSV graph export, the app converts each row into this manual format automatically.

### LLM Output

LLM rows are expected to contain these fields:

```text
source, source_type, relation, target, target_type
```

Example:

```text
Bangladesh, Country, has, agro-based economy, Economic characteristic
```

The app can also read common Neo4j graph export formats and convert them into the same internal structure.

## 2. Text Normalisation

Before comparing text, the system normalises each value.

It:

- converts text to lowercase
- removes punctuation and symbols
- splits text into words
- ignores empty words

Example:

```text
"Agro-based Economy!"
```

becomes:

```text
["agrobased", "economy"]
```

This means matching is based on word overlap, not exact sentence formatting.

## 3. Word Similarity Formula

The system uses Jaccard similarity to compare two pieces of text.

Formula:

```text
Jaccard similarity = shared words / total unique words
```

Example:

```text
Manual: "agro based economy"
LLM:    "agro economy"
```

Shared words:

```text
agro, economy = 2
```

Total unique words:

```text
agro, based, economy = 3
```

Score:

```text
2 / 3 = 0.67, or 67%
```

## 4. Triple Matching Score

Each manual triple is compared against every LLM triple. The system calculates a score for source, relation, and target separately.

The final triple score is weighted like this:

```text
Triple score = (source score × 0.4) + (relation score × 0.2) + (target score × 0.4)
```

So:

- Source is worth 40%
- Relation is worth 20%
- Target is worth 40%

Source and target matter most because they identify the main entities in the relationship.

## 5. Selecting the Best LLM Match

For each manual row, the system checks all LLM rows and keeps the LLM row with the highest triple score.

Simple process:

```text
For each manual triple:
  compare it with every LLM triple
  calculate a score for each pair
  choose the LLM triple with the highest score
```

That chosen LLM triple becomes the best candidate match for that manual row.

## 6. Threshold Classification

The threshold controls how strict the match decision is.

The threshold is stored as a percentage in the UI, then converted into a decimal.

Example:

```text
60% threshold = 0.60
```

The system also creates a partial-match threshold:

```text
Partial threshold = match threshold × 0.5
```

Example:

```text
60% match threshold
Partial threshold = 60% × 0.5 = 30%
```

Classification rules:

```text
If score >= threshold:
  Match

Else if score >= partial threshold:
  Partial

Else:
  Miss
```

Example with a 60% threshold:

| Score | Result |
|---:|---|
| 70% | Match |
| 45% | Partial |
| 20% | Miss |

If the threshold is increased, the system becomes stricter. If the threshold is decreased, the system becomes more forgiving.

## 7. Match, Partial, and Miss Counts

The system counts how many manual rows fall into each category.

```text
matches  = number of rows classified as Match
partials = number of rows classified as Partial
misses   = number of rows classified as Miss
```

Manual count:

```text
manualCount = total number of manual rows
```

LLM count:

```text
llmCount = total number of LLM triples
```

## 8. True Positives, False Positives, and False Negatives

The app gives partial matches half credit.

### True Positives

```text
TP = matches + (partials × 0.5)
```

A full match counts as 1 correct result. A partial match counts as 0.5 correct.

### False Positives

```text
FP = max(llmCount - TP, 0)
```

This estimates how many LLM outputs were not correctly matched to the manual data.

### False Negatives

```text
FN = misses + (partials × 0.5)
```

A miss counts as 1 missing result. A partial match counts as 0.5 missing.

## 9. Precision

Precision answers this question:

```text
Of the LLM outputs, how many were correct?
```

Formula:

```text
Precision = TP / (TP + FP)
```

Higher precision means the LLM produced fewer extra or incorrect triples.

## 10. Recall

Recall answers this question:

```text
Of the manual expected facts, how many did the LLM find?
```

Formula:

```text
Recall = TP / (TP + FN)
```

Higher recall means the LLM found more of the expected manual extractions.

## 11. F1 Score

F1 combines precision and recall into one balanced score.

Formula:

```text
F1 = 2 × precision × recall / (precision + recall)
```

F1 is useful when you want one number that balances correctness and coverage.

## 12. Accuracy

Accuracy is based on manual rows and partial credit.

Formula:

```text
Accuracy = TP / manualCount
```

Because partial matches count as 0.5, accuracy gives some credit for partially correct extractions.

## 13. Hallucinations

The system treats unmatched LLM triples as hallucinations.

Formula:

```text
Hallucinations = round(FP)
```

Hallucination rate:

```text
Hallucination rate = FP / llmCount
```

Simple meaning:

```text
If the LLM produced triples that did not match the manual extraction, those are counted as hallucinated or extra outputs.
```

At row level, a row is marked as hallucinated when the LLM triple is attached to a miss or is not part of the matched LLM set.

## 14. Best Result Highlighting

Saved results are ranked so the best-performing run can be highlighted.

The ranking order is:

1. Higher F1 score
2. Higher accuracy
3. Higher precision
4. Higher recall
5. Lower hallucination rate
6. Lower hallucination count

In formula-like form, the app ranks by this tuple:

```text
[F1, accuracy, precision, recall, -hallucinationRate, -hallucinations]
```

The negative hallucination values mean lower hallucination results are better.

## 15. Simple Example

Assume:

```text
manualCount = 10
llmCount = 12
matches = 6
partials = 2
misses = 2
```

True positives:

```text
TP = 6 + (2 × 0.5) = 7
```

False positives:

```text
FP = 12 - 7 = 5
```

False negatives:

```text
FN = 2 + (2 × 0.5) = 3
```

Precision:

```text
Precision = 7 / (7 + 5) = 7 / 12 = 58.3%
```

Recall:

```text
Recall = 7 / (7 + 3) = 7 / 10 = 70.0%
```

F1:

```text
F1 = 2 × 0.583 × 0.700 / (0.583 + 0.700) = 63.6%
```

Accuracy:

```text
Accuracy = 7 / 10 = 70.0%
```

Hallucinations:

```text
Hallucinations = round(5) = 5
```

Hallucination rate:

```text
Hallucination rate = 5 / 12 = 41.7%
```

## 16. Plain-English Summary

The system compares each manual triple with every LLM triple and chooses the closest LLM match. It scores similarity by checking word overlap in source, relation, and target, with source and target weighted more heavily. The threshold decides whether the score becomes a match, partial match, or miss. Partial matches receive half credit. Precision, recall, F1, accuracy, and hallucination rate are then calculated from those match, partial, and miss counts.
