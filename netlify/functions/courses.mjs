import catalog from '../lib/course-catalog.cjs';

const handler = catalog.createHandler();

// The modern Functions API provides Blobs credentials, including strong-consistency endpoints.
export default async request => {
  const result = await handler({
    httpMethod: request.method,
    body: request.method === 'POST' ? await request.text() : null,
    queryStringParameters: Object.fromEntries(new URL(request.url).searchParams),
  });
  return new Response(result.body, { status: result.statusCode, headers: result.headers });
};
