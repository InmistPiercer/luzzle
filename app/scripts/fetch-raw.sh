#!/bin/sh
set -e
cd "$(dirname "$0")/.."
mkdir -p raw
get() { [ -s "raw/$1" ] || curl -fL --retry 3 -o "raw/$1" "$2"; }
get ecdict.csv https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv
get MorphoLEX_en.xlsx https://raw.githubusercontent.com/hugomailhot/MorphoLex-en/master/MorphoLEX_en.xlsx
get eng.derivational.v1.tsv https://raw.githubusercontent.com/kbatsuren/MorphyNet/main/eng/eng.derivational.v1.tsv
[ -s raw/eng_sentences.tsv.bz2 ] || [ ! -s ../eng_sentences.tsv.bz2 ] || cp ../eng_sentences.tsv.bz2 raw/
ls -la raw
