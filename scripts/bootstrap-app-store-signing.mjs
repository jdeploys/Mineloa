import { createPrivateKey, sign } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

for (const name of ['ASC_API_PRIVATE_KEY', 'ASC_API_KEY_ID', 'ASC_API_ISSUER_ID']) {
  if (!process.env[name]) throw new Error(`Missing ${name}`)
}

const base64url = (value) => Buffer.from(value).toString('base64url')
const now = Math.floor(Date.now() / 1000)
const header = base64url(JSON.stringify({ alg: 'ES256', kid: process.env.ASC_API_KEY_ID, typ: 'JWT' }))
const payload = base64url(JSON.stringify({
  iss: process.env.ASC_API_ISSUER_ID,
  iat: now - 20,
  exp: now + 1200,
  aud: 'appstoreconnect-v1',
}))
const input = `${header}.${payload}`
const signature = sign('sha256', Buffer.from(input), {
  key: createPrivateKey(process.env.ASC_API_PRIVATE_KEY),
  dsaEncoding: 'ieee-p1363',
}).toString('base64url')
const token = `${input}.${signature}`

async function api(path, options = {}) {
  const response = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...options.headers,
    },
  })
  const body = await response.json()
  if (!response.ok) throw new Error(`${options.method ?? 'GET'} ${path}: ${response.status} ${JSON.stringify(body)}`)
  return body
}

async function createCertificate(certificateType, csrPath) {
  const csrContent = await readFile(csrPath, 'utf8')
  return api('/v1/certificates', {
    method: 'POST',
    body: JSON.stringify({
      data: { type: 'certificates', attributes: { certificateType, csrContent } },
    }),
  })
}

const distribution = await createCertificate('DISTRIBUTION', 'signing-assets/distribution.csr')
const installer = await createCertificate('MAC_INSTALLER_DISTRIBUTION', 'signing-assets/installer.csr')
const bundleIds = await api('/v1/bundleIds?filter%5Bidentifier%5D=com.jdeploys.mineloa')
const bundleId = bundleIds.data.find((item) => item.attributes.identifier === 'com.jdeploys.mineloa')
if (!bundleId) throw new Error('Bundle ID com.jdeploys.mineloa was not found')

const profile = await api('/v1/profiles', {
  method: 'POST',
  body: JSON.stringify({
    data: {
      type: 'profiles',
      attributes: { name: `Mineloa Mac App Store CI ${Date.now()}`, profileType: 'MAC_APP_STORE' },
      relationships: {
        bundleId: { data: { type: 'bundleIds', id: bundleId.id } },
        certificates: { data: [{ type: 'certificates', id: distribution.data.id }] },
      },
    },
  }),
})

await mkdir('signing-assets', { recursive: true })
await writeFile('signing-assets/distribution.cer', Buffer.from(distribution.data.attributes.certificateContent, 'base64'))
await writeFile('signing-assets/installer.cer', Buffer.from(installer.data.attributes.certificateContent, 'base64'))
await writeFile('signing-assets/Mineloa.provisionprofile', Buffer.from(profile.data.attributes.profileContent, 'base64'))
await writeFile('signing-assets/metadata.json', JSON.stringify({
  distributionCertificateId: distribution.data.id,
  installerCertificateId: installer.data.id,
  profileId: profile.data.id,
}, null, 2))
