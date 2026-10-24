# Adding a language

Add a JSON file in this folder named with its language code, for example `fr.json`.
Use this structure:

```json
{
  "languageName": "Français",
  "translation": {
    "local": "Local"
  }
}
```

`languageName` is shown in the language selector. Add the same translation keys used
in `en.json`; missing keys fall back to English. Vite discovers locale JSON files
automatically, so no registration in the i18n setup or selector is needed.
