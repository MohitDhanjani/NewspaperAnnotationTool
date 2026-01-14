# Newspaper Coding Tool (NCT)

Newspaper Coding Tool (NCT) is an open-source application designed for researchers to perform content coding and annotation on newspaper images. Developed by modifying the VGG Image Annotator (VIA), NCT allows users to annotate newspaper images with attributes tailored for content analysis.

## Features
- **User-Friendly Interface**: Simple to use; download the `nct.html` and open it in any modern web browser.
- **Image Support**: Supports image files (PDF not supported presently).
- **Core Attributes**:
    - **Type**: Values include Article, Byline, Body, Lead, and Item.
    - **Text**: Input text manually or using OCR with AWS Textract.
    - **Codes**: Add coding categories.
    - **Notes**: Add helpful notes while coding.
- **AWS Textract Integration**: Use AWS Textract for OCR by connecting with AWS Lambda Function URL.
- **Export Annotations**: Export annotated data as a CSV file for further analysis.
- **Custom Attributes**: Add additional attributes to suit your research needs.

## Getting Started
1. **Download** the `nct.html` file.
2. **Copy** the `nct.html` file to the directory containing your newspaper images.
3. **Open** the `nct.html` file in any modern web browser.
4. **Add Pages**: Load your image files into the application.
5. **Draw Regions**: Use the rectangle or polygon tool to annotate regions.
6. **Annotate and Code**: Annotate regions using different attributes.

### AWS Textract Setup
1. **AWS Account**: Ensure you have an AWS account.
2. **CloudFormation Template**: Use the [CloudFormation template](https://console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=NCTStandaloneAnalyseDocument&templateURL=https://nctappsource.s3.ap-south-1.amazonaws.com/NCTOCRTemplate.yaml) to set up the necessary AWS Lambda function.
3. **API Key**: Generate an API key and save it along with the Function URL in the application's settings.

## Usage
1. **Select Type Attribute**: Choose appropriate values for Type (e.g., Headline, Byline, Body, Lead).
2. **Input Text**: Manually enter text or use OCR.
3. **Add Codes**: Categorize content with coding categories.
4. **Annotate**: Ensure each article component (Headline, Byline, Lead, Body) is part of an Article container.
5. **Export**: Once done, export the annotations as a CSV file for further analysis in software like Excel or R.

## Limitations

- **No PDF Support**. Each page in PDF must be converted into an image file. This step can be automated using a script or Apple Shortcuts app on macOS.
- **File Size Limitations**. If you are using AWS Textract, then the image size should be less than 5 MB. This is not the limit of AWS Textract (which is around 10 MB). This is the limit of AWS Lambda which is being used as proxy.

# Notes Regarding Development

There are mainly two files that were added and written using TypeScript - 
 - NATOCR.ts
 - NewspaperAnnotationTool.ts

The development was done using JetBrains WebStorm IDE, and it takes care of compiling the TypeScript files into JavaScript files.

The other important part is the webpack configuration file.
Due to imports related to AWS Textract, Turf.js, and other libraries, it is essential that a bundle must be created in a single JS file that can then be referenced in the HTML file.

Lastly, the pack_via.py script which again is essential for bundling the NCT files into a single nct.html file.
This nct.html is the main and the only file required to run the application.