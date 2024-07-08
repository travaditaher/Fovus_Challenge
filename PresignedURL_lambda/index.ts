import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3Client = new S3Client({});
const BUCKET_NAME = process.env.BUCKET_NAME!;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const body = JSON.parse(event.body || '{}');
        const { fileName, fileType } = body;

        if (!BUCKET_NAME || !fileName || !fileType) {
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ error: 'Missing required parameters' }),
            };
        }

        const params = {
            Bucket: BUCKET_NAME,
            Key: fileName,
            // Expires: 120, // Expires in 120 seconds
            ContentType: fileType,
        };

        // Generate signed URL for uploading object to S3
        const command = new PutObjectCommand(params);
        console.log(command)
        const url = await getSignedUrl(s3Client, command, { expiresIn: 120 });

        console.log('Generated Presigned URL:', url);

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ url, BUCKET_NAME }),
        };
    } catch (error) {
        console.error('Error generating pre-signed URL', error);
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ error: 'Error generating pre-signed URL' }),
        };
    }
};
