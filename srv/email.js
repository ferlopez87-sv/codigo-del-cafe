import crypto from 'crypto';
let resendClient = null;
async function getResend(){
  if(!process.env.RESEND_API_KEY) return null;
  if(resendClient) return resendClient;
  const { Resend } = await import('resend');
  resendClient = new Resend(process.env.RESEND_API_KEY);
  return resendClient;
}

export function generarCodigo(){
  return String(Math.floor(100000 + Math.random()*900000));
}

export function hashCodigo(codigo){
  const secret = process.env.COOKIE_SECRET || 'dev-secret';
  return crypto.createHmac('sha256', secret).update(String(codigo)).digest('hex');
}

export async function enviarCodigo(correo, codigo){
  const from = process.env.RESEND_FROM || 'onboarding@resend.dev';
  if(!process.env.RESEND_API_KEY){
    console.log(`[email local] OTP para ${correo}: ${codigo} (RESEND_API_KEY no definida — comportamiento esperado en Docker §6.2)`);
    return { ok: true, local:true };
  }
  try{
    const resend = await getResend();
    const { error } = await resend.emails.send({
      from,
      to: correo,
      subject: 'Tu código de acceso — Misión: El código secreto del café',
      html: `<p>Tu código de 6 dígitos es <strong style="font-size:24px;letter-spacing:.2em">${codigo}</strong></p><p>Vence en 5 minutos. Si no lo pediste, ignorá este correo.</p>`
    });
    if(error) {
      console.error('[email] Resend error', error);
      return { ok:false, error };
    }
    console.log(`[email] OTP enviado a ${correo}`);
    return { ok:true };
  }catch(e){
    console.error('[email] fallo envío', e);
    return { ok:false, error:e };
  }
}
