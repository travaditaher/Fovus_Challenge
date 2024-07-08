import axios from "axios";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

const schema = z.object({
  textInput: z
    .string()
    .min(3, { message: "Text input should be at least 3 characters long" }),
  fileInput: z.instanceof(FileList).refine((files) => files.length > 0, {
    message: "File is required",
  }),
});

type FovusFormFields = z.infer<typeof schema>;


const s3PresignedUrlApi =
import.meta.env.VITE_REACT_APP_S3_PRESIGNED_URL_API + "generate-presigned-url";
const dynamoDbApi = import.meta.env.VITE_REACT_APP_DYNAMODB_API + "data-storage";

export default function FovusForm() {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FovusFormFields>({ resolver: zodResolver(schema) });
  const [uploading, setUploading] = useState(false);

  const onSubmit = async (data: FovusFormFields) => {
    try {
      setUploading(true);

      let file = data.fileInput[0];

      const fileName = file.name;

      const modifiedFileName = `${fileName}.Input`;
      const fileType = file.type;

      file = new File([file], modifiedFileName, { type: fileType });

      const getPresignedUrlApiResponse = await axios.post(s3PresignedUrlApi, {
        fileName: modifiedFileName,
        fileType,
      });

      const presignedUrl = getPresignedUrlApiResponse.data.url;
      console.log('presignedUrl: ', presignedUrl)

      const bucketName = getPresignedUrlApiResponse.data.BUCKET_NAME;
      const objectPath = `${bucketName}/${modifiedFileName}`;

      await axios.put(presignedUrl, file, {
        headers: { "Content-Type": fileType },
      });

      await axios.post(dynamoDbApi, {
        textInput: data.textInput,
        s3Path: objectPath,
      });

      alert("File uploaded successfully.");
    } catch (error) {
      alert("Error uploading the file.");
      console.log(error);
    } finally {
      reset();
      setUploading(false);
    }
  };

  return (
    <div className="container-fluid m-3 p-3">
      <h1 className="h-1">Fovus Code Challenge</h1>
      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="mb-3">
          <label className="form-label">Text Input</label>
          <input
            type="text"
            className="form-control"
            {...register("textInput", { required: true, minLength: 3 })}
          />
          {errors.textInput && (
            <p className="text-danger my-1">{errors.textInput.message}</p>
          )}
        </div>
        <div className="mb-3">
          <label className="form-label">File Input</label>
          <input
            className="form-control"
            type="file"
            {...register("fileInput", { required: true })}
          />
          {errors.fileInput && (
            <p className="text-danger my-1">{errors.fileInput.message}</p>
          )}
        </div>
        <button type="submit" className="btn btn-primary" disabled={uploading}>
          {uploading ? "Uploading..." : "Submit"}
        </button>
      </form>
    </div>
  );
}
