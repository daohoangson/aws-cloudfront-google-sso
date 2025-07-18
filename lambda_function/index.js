// @ts-check

import jsonwebtoken from "jsonwebtoken";

const CALLBACK_PATH = "/callback";

/** @type {Record<string, string>|undefined} */
let globalPems = undefined;

/**
 * @param {string} keyId
 * @returns {Promise<string|undefined>}
 */
async function getPemByKeyId(keyId) {
  if (keyId.length === 0) return undefined;
  if (typeof globalPems !== "undefined") {
    return globalPems[keyId];
  }

  console.log("Downloading PEMs...");
  try {
    const response = await fetch("https://www.googleapis.com/oauth2/v1/certs");
    const pems = (globalPems = await response.json());
    console.log("Downloaded PEMs", Object.keys(pems));
    return pems[keyId];
  } catch (error) {
    console.error("Failed to download PEMs", error);
    return undefined;
  }
}

/**
 *
 * @param {import('aws-lambda').CloudFrontHeaders} headers
 * @returns {Record<string, string|undefined>}
 */
function parseCookies(headers) {
  /** @type {Record<string, string|undefined>} */
  const parsedCookie = {};
  if (headers.cookie) {
    headers.cookie[0].value.split(";").forEach((cookie) => {
      if (cookie) {
        const parts = cookie.split("=");
        parsedCookie[parts[0].trim()] = parts[1].trim();
      }
    });
  }
  return parsedCookie;
}

/**
 * @param {import('aws-lambda').CloudFrontRequest} request
 * @returns {import('aws-lambda').CloudFrontResultResponse}
 */
function showGoogleSignInButton(request) {
  const { headers } = request;
  const host = headers.host ? headers.host[0].value : undefined;

  const body = `
<!DOCTYPE html>
<html lang="en">
  <head>
    <script src="https://accounts.google.com/gsi/client" async></script>
  </head>
  <body>
    <div id="g_id_onload" data-client_id="241235033991-terisug560a1st8rbcl8ujl46etkvtsc.apps.googleusercontent.com" data-context="signin" data-ux_mode="redirect" data-login_uri="https://${host}${CALLBACK_PATH}" data-auto_prompt="false"></div>
    <div class="g_id_signin" data-type="standard" data-shape="rectangular" data-theme="filled_blue" data-text="signin_with" data-size="large" data-logo_alignment="left"></div>
  </body>
</html>
  `;

  return {
    status: "200",
    statusDescription: "OK",
    body,
  };
}

/**
 * @param {string} credential
 * @returns {Promise<boolean>}
 */
async function verifyCredential(credential) {
  const jwt = jsonwebtoken.decode(credential, { complete: true });
  if (jwt === null) {
    console.error("Could not decode JWT", { credential });
    return false;
  }

  const jwtPayload = jwt.payload;
  const issuer = typeof jwtPayload === "string" ? "" : jwtPayload.iss;
  if (issuer !== "https://accounts.google.com") {
    console.error("Invalid issuer", { credential, issuer });
    return false;
  }

  const keyId = jwt.header.kid || "";
  const pem = await getPemByKeyId(keyId);
  if (typeof pem !== "string") {
    console.error("Invalid key ID", { credential, keyId });
    return false;
  }

  try {
    jsonwebtoken.verify(credential, pem, { issuer });
    return true;
  } catch (error) {
    console.error("Invalid credential", { credential, error });
    return false;
  }
}

/**
 * @type {import('aws-lambda').CloudFrontRequestHandler}
 */
export const handler = async (event) => {
  const request = event.Records[0].cf.request;
  const headers = request.headers;
  switch (request.uri) {
    case "/favicon.ico":
      return request;
  }

  const parsedCookie = parseCookies(headers);
  if (request.method === "POST" && request.uri === "/callback") {
    const body = Buffer.from(request.body?.data || "", "base64").toString();
    const bodyParams = new URLSearchParams(body);
    if (parsedCookie.g_csrf_token !== bodyParams.get("g_csrf_token")) {
      console.error("Invalid CSRF token", { parsedCookie, body });
      return showGoogleSignInButton(request);
    }

    const bodyCredential = bodyParams.get("credential") || "";
    if (await verifyCredential(bodyCredential)) {
      return {
        status: "302",
        statusDescription: "Found",
        headers: {
          Location: [{ key: "Location", value: "/" }],
          "Set-Cookie": [
            {
              key: "Set-Cookie",
              value: `credential=${bodyCredential}; Secure; HttpOnly`,
            },
          ],
        },
      };
    } else {
      return showGoogleSignInButton(request);
    }
  }

  const cookieCredential = parsedCookie.credential || "";
  if (await verifyCredential(cookieCredential)) {
    return request;
  } else {
    return showGoogleSignInButton(request);
  }
};
