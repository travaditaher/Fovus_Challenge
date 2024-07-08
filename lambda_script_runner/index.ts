import { EC2Client, DescribeImagesCommand, RunInstancesCommand, _InstanceType, RunInstancesCommandInput } from "@aws-sdk/client-ec2";
import { DynamoDBStreamEvent, DynamoDBStreamHandler } from "aws-lambda";

const ec2Client = new EC2Client({});

export const handler: DynamoDBStreamHandler = async (event: DynamoDBStreamEvent): Promise<void> => {
  const describeImagesParams = {
    Filters: [
      { Name: 'name', Values: ['ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*'] },
      { Name: 'architecture', Values: ['x86_64'] },
      { Name: 'virtualization-type', Values: ['hvm'] },
      { Name: 'root-device-type', Values: ['ebs'] }
    ],
    Owners: ['099720109477'], // Canonical (ubuntu company)
  };

  try {
    const describeImagesCommand = new DescribeImagesCommand(describeImagesParams);
    const imageResult = await ec2Client.send(describeImagesCommand);

    if (!imageResult.Images || imageResult.Images.length === 0) {
      throw new Error('No AMIs found that match the given criteria.');
    }

    const sortedImages = imageResult.Images
      .filter(image => image.CreationDate)
      .sort((a, b) => new Date(b.CreationDate!).getTime() - new Date(a.CreationDate!).getTime());

    if (sortedImages.length === 0) {
      throw new Error('No AMIs found that match the given criteria after filtering for CreationDate.');
    }

    const amiId = sortedImages[0].ImageId;

    console.log(amiId);

    if (!event.Records || !Array.isArray(event.Records)) {
      throw new Error('Event does not contain Records array');
    }

    for (const record of event.Records) {
      if (record.eventName === 'INSERT') {
        const newItem = record.dynamodb?.NewImage;
        const id = newItem?.id.S;
        const textInput = newItem?.text_input.S;
        let s3Path = newItem?.input_file_path.S;
        s3Path = s3Path?.replace('.Input', '');

        const tableName = process.env.TABLE_NAME as string;
        const bucketName = process.env.SCRIPT_BUCKET_NAME as string;

        const userDataScript = `#!/bin/bash
        sudo apt-get update
        sudo apt-get install unzip -y
        sudo su

        cd /home/ubuntu

        curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
        unzip awscliv2.zip
        sudo ./aws/install
        
        curl "https://s3.amazonaws.com/ec2-downloads-windows/SSMAgent/latest/debian_amd64/amazon-ssm-agent.deb" -o "amazon-ssm-agent.deb"
        dpkg -i amazon-ssm-agent.deb

        aws s3 cp s3://${bucketName}/ec2_script.sh /home/ubuntu/ec2_script.sh
        chmod +x /home/ubuntu/ec2_script.sh
        /home/ubuntu/ec2_script.sh ${id} '${textInput}' '${s3Path}' ${tableName}`;

        const runInstancesParams: RunInstancesCommandInput = {
          ImageId: amiId,
          InstanceType: _InstanceType.t3_small,
          MinCount: 1,
          MaxCount: 1,
          UserData: Buffer.from(userDataScript).toString('base64'),
          KeyName: process.env.KEY_NAME as string,
          SecurityGroupIds: [process.env.SECURITY_GROUP_ID as string],
          IamInstanceProfile: {
            Name: process.env.INSTANCE_PROFILE_NAME as string
          },
          SubnetId: process.env.SUBNET_ID as string,
        };

        try {
          const runInstancesCommand = new RunInstancesCommand(runInstancesParams);
          const instanceData = await ec2Client.send(runInstancesCommand);
          console.log('EC2 instance launched:', instanceData);
        } catch (error) {
          console.error('Error launching EC2 instance:', error);
        }
      }
    }
  } catch (error) {
    console.error('Error describing images:', error);
  }
};
