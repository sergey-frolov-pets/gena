import type { LocaleMessages } from "../types";

export const connectionsMessages = {
  "connections.title": "एजेंट कनेक्शन",
  "connections.intro":
    "एजेंट की कुंजी आपके ब्राउज़र में एन्क्रिप्ट होकर रखी जाती है (AES-GCM, कुंजी इसी डिवाइस पर रहती है)। कुंजियाँ बैकअप में कभी नहीं जातीं।",
  "connections.newAgent": "नया एजेंट",
  "connections.field.name": "नाम",
  "connections.field.namePlaceholder": "मेरा एजेंट",
  "connections.field.address": "पता (URL endpoint)",
  "connections.field.addressPlaceholder": "https://agent.example.com/chat",
  "connections.field.key": "कुंजी (Bearer token)",
  "connections.field.keyPlaceholder": "गोपनीय",
  "connections.field.contextSize": "कॉन्टेक्स्ट आकार (संदेश)",
  "connections.field.callLimit": "प्रति दिन कॉल सीमा (0 — कोई सीमा नहीं)",
  "connections.field.llmModel": "LLM मॉडल",
  "connections.field.llmModelPlaceholder": "जैसे gpt-4o-mini",
  "connections.add": "जोड़ें",
  "connections.added": "एजेंट जोड़ा गया",
  "connections.missingFields": "एजेंट का नाम और पता भरें",
  "connections.list": "एजेंट सूची",
  "connections.empty": "अभी कोई एजेंट नहीं है।",
  "connections.remove": "हटाएँ",
  "connections.summary": "कॉन्टेक्स्ट: {contextSize} · प्रति दिन सीमा: {callLimit} · मॉडल: {model}",
  "connections.keySaved": "कुंजी सहेजी गई — बदलने के लिए नई कुंजी डालें",
  "connections.keyMissing": "कुंजी सेट नहीं है",
  "connections.saveKey": "कुंजी सहेजें",
  "connections.keyUpdated": "कुंजी अपडेट हुई",
} as const satisfies LocaleMessages;
