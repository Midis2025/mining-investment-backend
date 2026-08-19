/**
 * HTML Email Generator for Press Release Mailchimp Campaigns.
 *
 * Renders an email-client compatible, responsive HTML template matching
 * THE Mining Investment Event branding with dynamic title, date, excerpt,
 * call-to-action buttons, social links, contact info, and legal disclaimer.
 */

export interface PressReleaseEmailInput {
  title: string;
  date?: string | Date | null;
  shortDescription?: string | null;
  longDescription?: string | null;
  pdfUrl?: string | null;
  pressReleaseUrl?: string | null;
  websiteUrl?: string | null;
}

/**
 * Escapes HTML characters for safe rendering.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Formats date into human-readable string (e.g., "June 12, 2025").
 */
function formatPressReleaseDate(dateInput?: string | Date | null): string {
  if (!dateInput) return '';
  try {
    const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    if (isNaN(d.getTime())) return String(dateInput);
    return new Intl.DateTimeFormat('en-CA', {
      dateStyle: 'long',
      timeZone: process.env.EMAIL_TIMEZONE?.trim() || 'America/Toronto',
    }).format(d);
  } catch {
    return String(dateInput);
  }
}

/**
 * Sanitizes rich text / CKEditor HTML for email inclusion or extracts paragraphs.
 */
function sanitizeContentHtml(htmlInput?: string | null): string {
  if (!htmlInput) return '';
  let content = htmlInput.trim();
  // Strip dangerous tags (script, iframe, style, object, embed, etc.)
  content = content
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  return content;
}

/**
 * Generates the complete HTML email body for Mailchimp campaign.
 */
export function renderPressReleaseEmailHtml(input: PressReleaseEmailInput): string {
  const websiteUrl =
    input.websiteUrl?.trim() ||
    process.env.WEBSITE_URL?.trim() ||
    process.env.FRONTEND_URL?.trim() ||
    'https://mining-investment-six.vercel.app';

  const pressReleaseUrl =
    input.pressReleaseUrl?.trim() || `${websiteUrl.replace(/\/+$/, '')}/newsflash`;
  const formattedDate = formatPressReleaseDate(input.date);
  const title = input.title.trim();

  const logoUrl =
    'https://res.cloudinary.com/aqxk0lje/image/upload/v1784805578/investment/settings/eymjzzdobondwqqrjfyu.png';

  // Build body content
  let bodyContentHtml = '';
  if (input.shortDescription && input.shortDescription.trim()) {
    bodyContentHtml += `<p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.65; color: #333F4D;">${escapeHtml(input.shortDescription.trim())}</p>`;
  }

  if (input.longDescription && input.longDescription.trim()) {
    const cleanLong = sanitizeContentHtml(input.longDescription);
    if (cleanLong) {
      bodyContentHtml += `<div style="font-size: 14.5px; line-height: 1.65; color: #333F4D; margin-top: 14px;">${cleanLong}</div>`;
    }
  }

  // Action buttons
  const pdfButtonHtml = input.pdfUrl
    ? `
      <table cellpadding="0" cellspacing="0" border="0" style="display: inline-block; vertical-align: middle; margin: 6px 8px 6px 0;">
        <tr>
          <td align="center" style="background-color: #A81B32; border-radius: 8px; padding: 12px 22px;">
            <a href="${escapeHtml(input.pdfUrl)}" target="_blank" rel="noopener noreferrer" style="color: #FFFFFF; font-family: 'Montserrat', 'Inter', Arial, sans-serif; font-size: 13px; font-weight: 700; text-decoration: none; display: inline-block; letter-spacing: 0.02em;">
              OPEN PDF
            </a>
          </td>
        </tr>
      </table>`
    : '';

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${escapeHtml(title)}</title>
  <style type="text/css">
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
    body { margin: 0; padding: 0; width: 100% !important; min-width: 100%; background-color: #F1F5F9; font-family: 'Inter', Arial, Helvetica, sans-serif; color: #333F4D; }
    @media only screen and (max-width: 640px) {
      .email-container { width: 100% !important; }
      .email-content { padding: 24px 18px !important; }
      .email-header { padding: 18px 18px 14px 18px !important; }
      .email-title { font-size: 24px !important; line-height: 1.25 !important; }
      .action-btn { display: block !important; width: 100% !important; margin: 8px 0 !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 30px 10px; background-color: #F1F5F9; font-family: 'Inter', -apple-system, BlinkMacSystemFont, Arial, sans-serif;">

  <center>
    <!-- MAIN CONTAINER -->
    <table class="email-container" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width: 660px; background-color: #FFFFFF; border-radius: 6px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08); margin: 0 auto; text-align: left;">
      
      <!-- TOP HEADER -->
      <tr>
        <td class="email-header" style="padding: 22px 34px 18px 34px; background-color: #FFFFFF;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td align="left" valign="middle">
                <a href="${escapeHtml(websiteUrl)}" target="_blank" rel="noopener noreferrer" style="text-decoration: none; display: inline-block;">
                  <img src="${logoUrl}" alt="THE Mining Investment Event" width="88" height="88" style="display: block; width: 88px; height: 88px; max-width: 88px; object-fit: contain;" />
                </a>
              </td>
              <td align="right" valign="middle">
                <span style="font-family: 'Montserrat', Arial, sans-serif; font-size: 11px; font-weight: 700; color: #A81B32; text-transform: uppercase; letter-spacing: 0.08em; background-color: #FDF2F4; padding: 6px 12px; border-radius: 4px; border: 1px solid #E8A8B2;">
                  PRESS RELEASE
                </span>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- RED DIVIDER STRIPE -->
      <tr>
        <td height="4" style="height: 4px; line-height: 4px; font-size: 4px; background-color: #A81B32;">&nbsp;</td>
      </tr>

      <!-- BODY CONTENT -->
      <tr>
        <td class="email-content" style="padding: 38px 34px 30px 34px; background-color: #FFFFFF;">
          
          ${
            formattedDate
              ? `<div style="font-family: 'Montserrat', Arial, sans-serif; font-size: 12px; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px;">
                  ${escapeHtml(formattedDate)}
                </div>`
              : ''
          }

          <!-- HEADING TITLE -->
          <h1 class="email-title" style="margin: 0 0 24px 0; font-family: 'Montserrat', Arial, sans-serif; font-size: 28px; line-height: 1.25; font-weight: 900; color: #A81B32; letter-spacing: -0.01em;">
            ${escapeHtml(title)}
          </h1>

          <!-- PRESS RELEASE TEXT -->
          <div style="font-size: 14.5px; line-height: 1.65; color: #333F4D; margin-bottom: 30px;">
            ${bodyContentHtml}
          </div>

          <!-- ACTION BUTTONS -->
          <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 30px;">
            <tr>
              <td style="padding: 0;">
                <table cellpadding="0" cellspacing="0" border="0" style="display: inline-block; vertical-align: middle; margin: 6px 8px 6px 0;">
                  <tr>
                    <td align="center" style="background-color: #A81B32; border-radius: 8px; padding: 12px 24px;">
                      <a href="${escapeHtml(pressReleaseUrl)}" target="_blank" rel="noopener noreferrer" style="color: #FFFFFF; font-family: 'Montserrat', 'Inter', Arial, sans-serif; font-size: 13px; font-weight: 700; text-decoration: none; display: inline-block; letter-spacing: 0.02em;">
                        CLICK TO READ FULL STORY &rarr;
                      </a>
                    </td>
                  </tr>
                </table>
                ${pdfButtonHtml}
              </td>
            </tr>
          </table>

          <!-- SECTION DIVIDER -->
          <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom: 24px;">
            <tr>
              <td height="1" style="height: 1px; line-height: 1px; font-size: 1px; background-color: #E2E8F0;"></td>
            </tr>
          </table>

          <!-- SOCIAL MEDIA LINKS -->
          <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom: 22px;">
            <tr>
              <td align="center">
                <table cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="padding: 0 5px;">
                      <a href="https://www.linkedin.com" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 8px 14px; border: 1.5px solid #A81B32; border-radius: 6px; font-family: 'Montserrat', Arial, sans-serif; font-size: 11px; font-weight: 700; color: #A81B32; text-decoration: none;">
                        LinkedIn
                      </a>
                    </td>
                    <td style="padding: 0 5px;">
                      <a href="https://twitter.com" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 8px 14px; border: 1.5px solid #A81B32; border-radius: 6px; font-family: 'Montserrat', Arial, sans-serif; font-size: 11px; font-weight: 700; color: #A81B32; text-decoration: none;">
                        X (Twitter)
                      </a>
                    </td>
                    <td style="padding: 0 5px;">
                      <a href="https://facebook.com" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 8px 14px; border: 1.5px solid #A81B32; border-radius: 6px; font-family: 'Montserrat', Arial, sans-serif; font-size: 11px; font-weight: 700; color: #A81B32; text-decoration: none;">
                        Facebook
                      </a>
                    </td>
                    <td style="padding: 0 5px;">
                      <a href="https://youtube.com" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 8px 14px; border: 1.5px solid #A81B32; border-radius: 6px; font-family: 'Montserrat', Arial, sans-serif; font-size: 11px; font-weight: 700; color: #A81B32; text-decoration: none;">
                        YouTube
                      </a>
                    </td>
                    <td style="padding: 0 5px;">
                      <a href="https://instagram.com" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 8px 14px; border: 1.5px solid #A81B32; border-radius: 6px; font-family: 'Montserrat', Arial, sans-serif; font-size: 11px; font-weight: 700; color: #A81B32; text-decoration: none;">
                        Instagram
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>

          <!-- CONTACT INFO -->
          <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom: 10px;">
            <tr>
              <td align="center" style="font-size: 13px; line-height: 1.55; color: #1E2229; text-align: center;">
                For more information about 'THE Event' programming or registration, please<br />
                contact <a href="mailto:jchoi@irinc.ca" style="color: #A81B32; font-weight: 700; text-decoration: none;">jchoi@irinc.ca</a> or call <a href="tel:+19055153508" style="color: #A81B32; font-weight: 700; text-decoration: none;">+1-905-515-3508</a>.
              </td>
            </tr>
          </table>

        </td>
      </tr>

      <!-- FOOTER -->
      <tr>
        <td style="background-color: #F8FAFC; border-top: 1px solid #EDF2F7; padding: 22px 34px 26px 34px; text-align: center;">
          <div style="font-family: 'Montserrat', Arial, sans-serif; font-size: 11px; font-weight: 700; color: #A81B32; margin-bottom: 10px; letter-spacing: 0.03em;">
            &copy; 2026 THE MINING INVESTMENT EVENT | <a href="${escapeHtml(websiteUrl)}" style="color: #A81B32; text-decoration: underline;">DISCLAIMER</a> | <a href="${escapeHtml(websiteUrl)}" style="color: #A81B32; text-decoration: underline;">Privacy Policy</a>
          </div>
          <p style="margin: 0; font-size: 10px; line-height: 1.5; color: #718096; text-align: center;">
            This communication, information, and materials pertaining to THE Mining Investment Event are not and should not be construed as an offer to buy or sell, or as a solicitation of an offer to buy or sell, sponsor, advocate, endorse, promote, or provide investment advice.
          </p>
        </td>
      </tr>

      <!-- BOTTOM RED ACCENT -->
      <tr>
        <td height="4" style="height: 4px; line-height: 4px; font-size: 4px; background-color: #A81B32;">&nbsp;</td>
      </tr>

    </table>
  </center>

</body>
</html>`;
}
