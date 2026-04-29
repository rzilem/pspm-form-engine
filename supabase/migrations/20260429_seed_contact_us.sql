-- Seed: Contact US form definition (mirrors Gravity Forms form id=4)
-- Lives at /forms/contact-us once published. The Gravity Forms version
-- has 544 entries on contact-us-main; this seed matches its field set so
-- a side-by-side comparison can run before flipping the WordPress page.
--
-- Once verified, Phase 8 swaps the Elementor+EmailJS embed on
-- /contact-us-main to either an iframe or a thin WP shortcode wrapper
-- pointing at /forms/contact-us on this Cloud Run service.

INSERT INTO form_definitions (
  slug,
  title,
  description,
  status,
  field_schema,
  notification_config,
  confirmation_message,
  recaptcha_required
) VALUES (
  'contact-us',
  'Contact PS Property Management',
  'Reach out about HOA management services, request a proposal, or ask a general question.',
  'published',
  $$[
    {
      "id": "iAm",
      "label": "I am...",
      "type": "radio",
      "required": true,
      "options": [
        {"value": "homeowner", "label": "A homeowner / resident"},
        {"value": "boardMember", "label": "An HOA / Condo board member"},
        {"value": "developer", "label": "A developer"},
        {"value": "vendor", "label": "A vendor"},
        {"value": "other", "label": "Something else"}
      ]
    },
    {
      "id": "name",
      "label": "Your name",
      "type": "name",
      "required": true
    },
    {
      "id": "email",
      "label": "Email address",
      "type": "email",
      "required": true
    },
    {
      "id": "phone",
      "label": "Phone number",
      "type": "phone",
      "required": false,
      "helpText": "We'll only call if you select 'Phone' as your preferred contact method."
    },
    {
      "id": "topic",
      "label": "I want to get in touch with...",
      "type": "radio",
      "required": true,
      "options": [
        {"value": "newBusiness", "label": "New business / management proposal"},
        {"value": "currentResident", "label": "I'm a current resident with a question"},
        {"value": "currentBoard", "label": "I'm a board member at a community we already manage"},
        {"value": "vendor", "label": "Vendor inquiry"},
        {"value": "other", "label": "Other"}
      ]
    },
    {
      "id": "message",
      "label": "How can we assist you?",
      "type": "textarea",
      "required": true,
      "placeholder": "Tell us a bit about what you need.",
      "validation": {"maxLength": 5000}
    },
    {
      "id": "preferredContact",
      "label": "How would you like to be contacted?",
      "type": "radio",
      "required": true,
      "options": [
        {"value": "email", "label": "Email"},
        {"value": "phone", "label": "Phone"},
        {"value": "either", "label": "Either is fine"}
      ]
    }
  ]$$::jsonb,
  $${
    "rules": [
      {
        "recipients": ["info@psprop.net", "81db3b5010b969547658@cloudmailin.net"],
        "subject": "New Contact Us submission - {{field.topic}}"
      }
    ]
  }$$::jsonb,
  'Thanks for reaching out. We will get back to you within one business day.',
  true
)
ON CONFLICT (slug) DO NOTHING;
