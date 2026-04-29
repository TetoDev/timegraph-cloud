import { getSmtpConfig } from "./config/secrets";

function b64(str: string): string {
  return Buffer.from(str).toString("base64");
}

type Socket = any;

interface SmtpState {
  buffer: string;
  pending: ((line: string) => void) | null;
  pendingMulti: ((full: string) => void) | null;
  socket: Socket | null;
}

export async function sendVerificationEmail(to: string, code: string): Promise<void> {
  const config = await getSmtpConfig();

  const state: SmtpState = {
    buffer: "",
    pending: null,
    pendingMulti: null,
    socket: null,
  };

  function readLine(): Promise<string> {
    return new Promise((resolve, reject) => {
      state.pending = resolve;
      state.pendingMulti = null;
      state.buffer = "";
      processBuffer();
    });
  }

  function readMulti(): Promise<string> {
    return new Promise((resolve) => {
      state.pending = null;
      state.pendingMulti = resolve;
      state.buffer = "";
    });
  }

  function processBuffer(): void {
    if (state.pendingMulti) {
      if (state.buffer.endsWith("\r\n.\r\n")) {
        const full = state.buffer.trim();
        state.buffer = "";
        const cb = state.pendingMulti;
        state.pendingMulti = null;
        cb(full);
      }
      return;
    }

    if (!state.pending) return;

    const idx = state.buffer.indexOf("\r\n");
    if (idx === -1) return;

    const line = state.buffer.slice(0, idx);
    state.buffer = state.buffer.slice(idx + 2);

    if (line.length >= 4 && line[3] === "-") {
      state.pendingMulti = (full: string) => {
        state.pending?.(line);
      };
      state.pending = null;
      return;
    }

    const cb = state.pending;
    state.pending = null;
    cb(line);
  }

  function onData(data: ArrayBuffer | Buffer): void {
    state.buffer += new TextDecoder().decode(data instanceof Buffer ? data : new Uint8Array(data));
    processBuffer();
  }

  function send(cmd: string): void {
    if (!state.socket) return;
    state.socket.write(cmd + "\r\n");
  }

  function expectCode(line: string, expected: number): void {
    const code = parseInt(line.slice(0, 3), 10);
    if (code !== expected) {
      throw new Error(`SMTP error ${code}: ${line}`);
    }
  }

  return new Promise<void>((resolve, reject) => {
    let connected = false;

    Bun.connect({
      hostname: config.host,
      port: config.port,
      tls: true,
      socket: {
        open(socket) {
          state.socket = socket;
          connected = true;
        },
        data(_socket, data) {
          onData(data);
        },
        close() {
          if (!connected) {
            reject(new Error("SMTP connection closed before ready"));
          }
        },
        error(err) {
          reject(err);
        },
      },
    });

    (async () => {
      try {
        await Bun.sleep(50);
        const greeting = await readLine();
        expectCode(greeting, 220);

        send(`EHLO ${config.host}`);
        const ehlo = await readLine();
        expectCode(ehlo, 250);

        send("AUTH LOGIN");
        const authChallenge1 = await readLine();
        expectCode(authChallenge1, 334);

        send(b64(config.user));
        const authChallenge2 = await readLine();
        expectCode(authChallenge2, 334);

        send(b64(config.pass));
        const authResult = await readLine();
        expectCode(authResult, 235);

        send(`MAIL FROM:<${config.from}>`);
        const mailResult = await readLine();
        expectCode(mailResult, 250);

        send(`RCPT TO:<${to}>`);
        const rcptResult = await readLine();
        expectCode(rcptResult, 250);

        send("DATA");
        const dataReady = await readLine();
        expectCode(dataReady, 354);

        const subject = "PLPP - Your Verification Code";
        const body = `
          <html>
            <body style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
              <h2 style="color: #2563eb;">PLPP Verification Code</h2>
              <p style="font-size: 16px; color: #334155;">Enter the following code to verify your email address:</p>
              <div style="background: #f1f5f9; border-radius: 8px; padding: 16px; text-align: center; margin: 24px 0;">
                <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1e293b;">${code}</span>
              </div>
              <p style="font-size: 14px; color: #64748b;">This code expires in 10 minutes.</p>
              <p style="font-size: 12px; color: #94a3b8;">If you did not request this code, please ignore this email.</p>
            </body>
          </html>
        `;

        const headers = [
          `From: ${config.from}`,
          `To: ${to}`,
          `Subject: ${subject}`,
          "MIME-Version: 1.0",
          'Content-Type: text/html; charset="UTF-8"',
          "",
        ].join("\r\n");

        send(headers + "\r\n" + body + "\r\n.\r\n");
        const sendResult = await readLine();
        expectCode(sendResult, 250);

        send("QUIT");

        resolve();
      } catch (err: any) {
        reject(err);
      }
    })();
  });
}
