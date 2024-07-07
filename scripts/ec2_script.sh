#!/bin/bash

ID=$1
TEXT_INPUT=$2
S3_INPUT_PATH=$3
TABLE_NAME=$4

BUCKET_NAME=$(echo "$S3_INPUT_PATH" | cut -d'/' -f1)
S3_OBJECT_KEY=$(echo "$S3_INPUT_PATH" | cut -d'/' -f2-)

aws s3 cp s3://$S3_INPUT_PATH /home/ubuntu/input-file


FILE_CONTENT=$(cat /home/ubuntu/input-file)

TEXT_LENGTH=${#TEXT_INPUT}
OUTPUT_CONTENT="${FILE_CONTENT}: ${TEXT_LENGTH}"
echo "$OUTPUT_CONTENT" > /home/ubuntu/output-file

OUTPUT_PATH="s3://${BUCKET_NAME}/${S3_OBJECT_KEY}.Output"
aws s3 cp /home/ubuntu/output-file $OUTPUT_PATH

DYNAMO_OUTPUT="${BUCKET_NAME}/${S3_OBJECT_KEY}.Output"

# aws dynamodb put-item --table-name $TABLE_NAME --item "{\"id\": {\"S\": \"$ID\"}, \"output_file_path\": {\"S\": \"$OUTPUT_PATH\"}}"

aws dynamodb update-item \
    --table-name $TABLE_NAME \
    --key "{\"id\": {\"S\": \"$ID\"}}" \
    --update-expression "SET output_file_path = :outputPath" \
    --expression-attribute-values "{\":outputPath\": {\"S\": \"$DYNAMO_OUTPUT\"}}"

echo "Retrieving instance ID"
TOKEN=$(curl -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
INSTANCE_ID=$(curl -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)
echo "Instance ID: $INSTANCE_ID"

if [ -n "$INSTANCE_ID" ]; then
    echo "Terminating instance $INSTANCE_ID"
    aws ec2 terminate-instances --instance-ids $INSTANCE_ID
else
    echo "Instance ID is not set. Skipping termination."
fi